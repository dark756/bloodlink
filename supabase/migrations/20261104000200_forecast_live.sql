-- bloodLink: the stock-out forecast goes live (docs/PLANS/ML_system.md, Part A,
-- phases 2 and 3, brought forward to 4 November for the closed beta).
--
-- * forecast_post              posts a job to the score-stock Edge Function, with its
--                              URL and secret from Vault
-- * schedule_stock_forecast    two cron jobs: scoring after each grid time, and the
--                              daily outcomes, calibration and kill switch
-- * forecast_marks             what search reads: the latest scores for the banks it
--                              shows, the cut-off and the flags, only while a flag is on
--
-- This migration schedules nothing. scripts/setup-forecast.mjs stores the function's
-- URL and secret in Vault; then
--   select public.schedule_stock_forecast();     starts it
--   select public.unschedule_stock_forecast();   stops it

-- ── scheduling ───────────────────────────────────────────────────────────────

-- Posts p_body ({"job": "score"} or {"job": "daily"}) to score-stock. Returns
-- pg_net's request id.
create or replace function public.forecast_post(p_body jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'forecast_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'forecast_secret';
  if v_url is null or v_secret is null then
    raise exception 'forecast_url and forecast_secret must be in Vault' using errcode = 'P0002';
  end if;
  return net.http_post(
    url := v_url,
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-forecast-secret', v_secret),
    timeout_milliseconds := 150000);
end;
$$;

-- Creates or replaces the two cron jobs (UTC times):
-- * forecast-score at :35 past 00, 06, 12 and 18 UTC, which is 06:05, 12:05, 18:05
--   and 00:05 India time, five minutes after each grid time;
-- * forecast-daily at 21:45 UTC, 03:15 India time.
create or replace function public.schedule_stock_forecast()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select count(*) from vault.decrypted_secrets
      where name in ('forecast_url', 'forecast_secret')) < 2 then
    raise exception 'store forecast_url and forecast_secret in Vault first (scripts/setup-forecast.mjs)'
      using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'forecast-score', cron.schedule('forecast-score', '35 0,6,12,18 * * *',
      $job$select public.forecast_post('{"job": "score"}'::jsonb)$job$),
    'forecast-daily', cron.schedule('forecast-daily', '45 21 * * *',
      $job$select public.forecast_post('{"job": "daily"}'::jsonb)$job$));
end;
$$;

-- Removes the two cron jobs. Returns how many there were.
create or replace function public.unschedule_stock_forecast()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text;
  v_count integer := 0;
begin
  for v_name in
    select jobname from cron.job where jobname in ('forecast-score', 'forecast-daily')
  loop
    perform cron.unschedule(v_name);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ── what search reads ────────────────────────────────────────────────────────

-- The live model's latest scores (from the last 12 hours) for the banks a search
-- shows, for one component and group, with the alert cut-off at 48 h and the
-- low-stock threshold the model predicts. Returns only the flags while both the
-- badge and the ranking factor are off, so nothing leaks before they are turned on.
--   { showBadge, useInRanking, modelVersion, asOf, cutOff, thresholdUnits,
--     marks: [{ hospitalCode, p: [p24, p48, p72], reasons }] }
create or replace function public.forecast_marks(
  p_codes text[],
  p_component_id text,
  p_group_code text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_badge boolean;
  v_ranking boolean;
  v_model text;
  v_evaluation jsonb;
  v_as_of timestamptz;
  v_cut_off real;
  v_marks jsonb;
  v_off constant jsonb := jsonb_build_object('showBadge', false, 'useInRanking', false, 'marks', '[]'::jsonb);
begin
  if p_codes is null or cardinality(p_codes) > 500 then
    raise exception 'give at most 500 bank codes' using errcode = '22023';
  end if;
  select coalesce(bool_or(is_enabled) filter (where name = 'forecast_badge'), false),
         coalesce(bool_or(is_enabled) filter (where name = 'forecast_ranking'), false)
  into v_badge, v_ranking
  from public.feature_flags;
  if not (v_badge or v_ranking) then
    return v_off;
  end if;

  select id, evaluation into v_model, v_evaluation from public.model_versions where status = 'live';
  if v_model is null then
    return v_off;
  end if;
  select max(as_of) into v_as_of from public.stock_forecasts
  where model_version = v_model and as_of > now() - interval '12 hours';
  if v_as_of is null then
    return v_off;
  end if;
  -- The daily job's latest cut-off, or the model's starting one before the first.
  select cut_off into v_cut_off from public.forecast_daily_metrics
  where model_version = v_model and horizon_h = 48 and cut_off is not null
  order by day desc limit 1;
  v_cut_off := coalesce(v_cut_off, (v_evaluation -> 'by_horizon' -> '48' ->> 'cut_off')::real);

  select coalesce(jsonb_agg(jsonb_build_object(
           'hospitalCode', f.hospital_code, 'p', to_jsonb(f.p), 'reasons', f.reasons)), '[]'::jsonb)
  into v_marks
  from public.stock_forecasts f
  where f.model_version = v_model
    and f.as_of = v_as_of
    and f.component_id = p_component_id
    and f.blood_group_code = p_group_code
    and f.hospital_code = any (p_codes);

  return jsonb_build_object(
    'showBadge', v_badge,
    'useInRanking', v_ranking,
    'modelVersion', v_model,
    'asOf', v_as_of,
    'cutOff', v_cut_off,
    'thresholdUnits', coalesce((v_evaluation ->> 'threshold_units')::integer, 0),
    'marks', v_marks);
end;
$$;

-- ── grants ───────────────────────────────────────────────────────────────────

-- Only the cron jobs' owner (postgres) may post or schedule.
revoke execute on function public.forecast_post(jsonb),
  public.schedule_stock_forecast(),
  public.unschedule_stock_forecast()
  from public, anon, authenticated, service_role;

-- Search reads the marks with the publishable key, signed in or not.
revoke execute on function public.forecast_marks(text[], text, text) from public;
grant execute on function public.forecast_marks(text[], text, text) to anon, authenticated;
