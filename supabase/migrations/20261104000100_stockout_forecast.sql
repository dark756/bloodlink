-- bloodLink: the stock-out forecast in the app, Part A's groundwork
-- (docs/PLANS/ML_system.md, phase 0). Tables for scores, outcomes, runs and daily
-- metrics, the flags behind which the app uses them, and a limited role for the
-- scoring job. Nothing here scores anything or shows anything: every flag starts off.
--
-- * blood_banks.auto_refresh  from eRaktKosh's auto-refresh list, saved weekly
-- * feature_flags             the forecast's uses and admin events, each off
-- * model_versions            each exported model, its artifact and its evaluation
-- * stock_forecasts           P(stock-out) at 24, 48 and 72 h per bank, group, grid time
-- * forecast_outcomes         what happened, labelled a day or more later
-- * forecast_runs             one row per scoring or daily job, as collector_runs
-- * forecast_daily_metrics    the daily calibration, cut-off and metrics
-- * ml-models                 private Storage bucket for the artifacts
-- * bloodlink_ml              no-login role for the score-stock job (phase 2)
--
-- Who reads what: admins read every table; nobody else reads any, yet. The search
-- mark and the centres' view come later, through functions that check the flags.

-- ── the collector's new call and column ──────────────────────────────────────

alter table public.blood_banks add column auto_refresh boolean;

alter table public.upstream_calls drop constraint upstream_calls_endpoint_check;
alter table public.upstream_calls add constraint upstream_calls_endpoint_check
  check (endpoint in ('blood-availability', 'bloodbank/nearest', 'master/portal-refresh-hospitals'));

-- ── role ─────────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'bloodlink_ml') then
    create role bloodlink_ml nologin;
  end if;
end
$$;
grant bloodlink_ml to postgres;
grant usage on schema public to bloodlink_ml;

-- ── tables ───────────────────────────────────────────────────────────────────

create table public.feature_flags (
  name text primary key
    check (name in ('forecast_badge', 'forecast_ranking', 'forecast_appeals', 'admin_events')),
  is_enabled boolean not null default false,
  disabled_reason text check (char_length(disabled_reason) <= 500), -- set by the kill switch
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.feature_flags (name)
values ('forecast_badge'), ('forecast_ranking'), ('forecast_appeals'), ('admin_events');

create table public.model_versions (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9.-]{2,80}$'), -- 'stockout-logit-2027-01-04'
  kind text not null check (kind in ('logistic', 'gbm')),
  artifact_path text not null check (artifact_path ~ '^[a-z0-9][a-z0-9./-]{2,200}\.json$'),
  artifact_sha256 text not null check (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  trained_from date not null,
  trained_to date not null,
  evaluation jsonb not null,       -- the promotion rule's metrics, by horizon and group
  status text not null default 'shadow' check (status in ('shadow', 'live', 'retired')),
  created_at timestamptz not null default now(),
  check (trained_to >= trained_from)
);
-- One live model at a time; a challenger scores beside it in shadow.
create unique index model_versions_one_live on public.model_versions (status)
  where status = 'live';

-- A grid time is midnight, 06:00, noon or 18:00 India time (UTC+05:30).
create or replace function public.is_forecast_grid_time(p_time timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (extract(epoch from p_time)::bigint + 19800) % 21600 = 0;
$$;

create table public.stock_forecasts (
  hospital_code text not null check (hospital_code ~ '^[0-9]{1,10}$'),
  component_id text not null check (component_id ~ '^[0-9]{1,3}$'),
  blood_group_code text not null check (blood_group_code ~ '^[0-9]{1,3}$'),
  as_of timestamptz not null check (public.is_forecast_grid_time(as_of)),
  model_version text not null references public.model_versions (id),
  p_raw real[] not null,           -- 24, 48, 72 h, as the model gives them
  p real[] not null,               -- calibrated
  reasons jsonb not null,          -- the top three inputs, in words
  primary key (hospital_code, component_id, blood_group_code, as_of, model_version),
  check (array_length(p_raw, 1) = 3 and 0 <= all (p_raw) and 1 >= all (p_raw)),
  check (array_length(p, 1) = 3 and 0 <= all (p) and 1 >= all (p)),
  check (jsonb_typeof(reasons) = 'array')
);
create index stock_forecasts_as_of on public.stock_forecasts (as_of desc);

create table public.forecast_outcomes (
  hospital_code text not null check (hospital_code ~ '^[0-9]{1,10}$'),
  component_id text not null check (component_id ~ '^[0-9]{1,3}$'),
  blood_group_code text not null check (blood_group_code ~ '^[0-9]{1,3}$'),
  as_of timestamptz not null check (public.is_forecast_grid_time(as_of)),
  stockout boolean[] not null,     -- 24, 48, 72 h; null where the label rules leave it out
  had_appeal boolean not null default false, -- B3: reported apart
  labelled_at timestamptz not null default now(),
  primary key (hospital_code, component_id, blood_group_code, as_of),
  check (array_length(stockout, 1) = 3)
);
create index forecast_outcomes_as_of on public.forecast_outcomes (as_of desc);

create table public.forecast_runs (
  id bigint generated always as identity primary key,
  job text not null check (job in ('score', 'daily')), -- each grid time; outcomes and calibration
  as_of timestamptz not null,      -- the grid time scored, or the day calibrated
  model_version text references public.model_versions (id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_scored integer check (rows_scored >= 0),
  result jsonb,                    -- the daily job's cut-offs and kill-switch decision
  error text check (char_length(error) <= 1000)
);
create index forecast_runs_started_at on public.forecast_runs (started_at desc);

create table public.forecast_daily_metrics (
  day date not null,
  horizon_h smallint not null check (horizon_h in (24, 48, 72)),
  model_version text not null references public.model_versions (id),
  cases integer not null check (cases >= 0),
  positives integer not null check (positives >= 0),
  pr_auc real,
  calibration_ratio real,          -- mean prediction ÷ observed rate
  platt_a real,
  platt_b real,
  cut_off real check (cut_off between 0 and 1),
  recall_at_cut_off real,
  false_alerts_per_bank_week real,
  lift_by_group jsonb,
  primary key (day, horizon_h, model_version)
);

-- ── functions ────────────────────────────────────────────────────────────────

-- Turns one flag on or off, for admins, and writes the audit log. Turning a flag on
-- clears the kill switch's reason.
create or replace function public.set_feature_flag(p_name text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was boolean;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change feature flags' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'p_enabled must be true or false' using errcode = '22023';
  end if;
  select is_enabled into v_was from public.feature_flags where name = p_name for update;
  if not found then
    raise exception 'No such feature flag' using errcode = 'P0002';
  end if;
  update public.feature_flags
  set is_enabled = p_enabled,
      disabled_reason = case when p_enabled then null else disabled_reason end,
      updated_by = auth.uid(),
      updated_at = now()
  where name = p_name;
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), 'feature_flag.changed', 'feature_flag', p_name,
          jsonb_build_object('from', v_was, 'to', p_enabled));
end;
$$;

-- The kill switch (A4): turns the forecast's flags off with a reason and writes the
-- audit log with no actor. Leaves admin_events alone, since it doesn't depend on
-- the model. Returns how many flags it turned off.
create or replace function public.stop_forecast_flags(p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_names text[];
begin
  if p_reason is null or char_length(p_reason) not between 1 and 500 then
    raise exception 'A reason of 1 to 500 characters is required' using errcode = '22023';
  end if;
  with stopped as (
    update public.feature_flags
    set is_enabled = false, disabled_reason = p_reason, updated_by = null, updated_at = now()
    where name in ('forecast_badge', 'forecast_ranking', 'forecast_appeals') and is_enabled
    returning name
  )
  select coalesce(array_agg(name order by name), '{}') into v_names from stopped;
  if cardinality(v_names) > 0 then
    insert into public.audit_log (actor_id, action, target_type, target_id, details)
    values (null, 'feature_flag.kill_switch', 'feature_flag', null,
            jsonb_build_object('flags', v_names, 'reason', p_reason));
  end if;
  return cardinality(v_names);
end;
$$;

-- Keeps the forecast tables to the stock history's 60 days. The archive in Storage
-- keeps them for evaluation (A5).
create or replace function public.prune_forecasts(p_days integer default 60)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_forecasts integer;
  v_outcomes integer;
begin
  if p_days < 1 then
    raise exception 'retention must be at least one day' using errcode = '22023';
  end if;
  delete from public.stock_forecasts where as_of < now() - make_interval(days => p_days);
  get diagnostics v_forecasts = row_count;
  delete from public.forecast_outcomes where as_of < now() - make_interval(days => p_days);
  get diagnostics v_outcomes = row_count;
  return jsonb_build_object('forecasts_deleted', v_forecasts, 'outcomes_deleted', v_outcomes);
end;
$$;

-- ── artifact bucket ──────────────────────────────────────────────────────────

-- Private, with no policies: only a secret key reaches it. Layout:
--   <model_versions.id>.json   the exported artifact, named in artifact_path
insert into storage.buckets (id, name, public, allowed_mime_types)
values ('ml-models', 'ml-models', false, array['application/json'])
on conflict (id) do nothing;

-- ── row-level security ───────────────────────────────────────────────────────

alter table public.feature_flags enable row level security;
alter table public.model_versions enable row level security;
alter table public.stock_forecasts enable row level security;
alter table public.forecast_outcomes enable row level security;
alter table public.forecast_runs enable row level security;
alter table public.forecast_daily_metrics enable row level security;

create policy feature_flags_select_admin on public.feature_flags
  for select to authenticated using (public.is_admin());
create policy model_versions_select_admin on public.model_versions
  for select to authenticated using (public.is_admin());
create policy stock_forecasts_select_admin on public.stock_forecasts
  for select to authenticated using (public.is_admin());
create policy forecast_outcomes_select_admin on public.forecast_outcomes
  for select to authenticated using (public.is_admin());
create policy forecast_runs_select_admin on public.forecast_runs
  for select to authenticated using (public.is_admin());
create policy forecast_daily_metrics_select_admin on public.forecast_daily_metrics
  for select to authenticated using (public.is_admin());

create policy feature_flags_ml_read on public.feature_flags
  for select to bloodlink_ml using (true);
create policy model_versions_ml_read on public.model_versions
  for select to bloodlink_ml using (true);
create policy stock_forecasts_ml on public.stock_forecasts
  for all to bloodlink_ml using (true) with check (true);
create policy forecast_outcomes_ml on public.forecast_outcomes
  for all to bloodlink_ml using (true) with check (true);
create policy forecast_runs_ml on public.forecast_runs
  for all to bloodlink_ml using (true) with check (true);
create policy forecast_daily_metrics_ml on public.forecast_daily_metrics
  for all to bloodlink_ml using (true) with check (true);

-- The scoring job reads the stock store and the collector's runs (for gaps).
create policy blood_banks_ml_read on public.blood_banks
  for select to bloodlink_ml using (true);
create policy bank_stock_latest_ml_read on public.bank_stock_latest
  for select to bloodlink_ml using (true);
create policy stock_history_ml_read on public.stock_history
  for select to bloodlink_ml using (true);
create policy collector_runs_ml_read on public.collector_runs
  for select to bloodlink_ml using (true);

-- ── grants ───────────────────────────────────────────────────────────────────

revoke all on public.feature_flags, public.model_versions, public.stock_forecasts,
  public.forecast_outcomes, public.forecast_runs, public.forecast_daily_metrics
  from public, anon, authenticated;

grant select on public.feature_flags, public.model_versions, public.stock_forecasts,
  public.forecast_outcomes, public.forecast_runs, public.forecast_daily_metrics
  to authenticated;

grant select on public.feature_flags, public.model_versions to bloodlink_ml;
grant select, insert, delete on public.stock_forecasts to bloodlink_ml;
grant select, insert, update, delete on public.forecast_outcomes to bloodlink_ml;
grant select, insert, update on public.forecast_runs, public.forecast_daily_metrics to bloodlink_ml;
grant select on public.blood_banks, public.bank_stock_latest, public.stock_history,
  public.collector_runs to bloodlink_ml;

revoke execute on function public.set_feature_flag(text, boolean) from public, anon;
grant execute on function public.set_feature_flag(text, boolean) to authenticated;
revoke execute on function public.stop_forecast_flags(text) from public, anon, authenticated;
grant execute on function public.stop_forecast_flags(text) to bloodlink_ml;
revoke execute on function public.prune_forecasts(integer) from public, anon, authenticated;
grant execute on function public.prune_forecasts(integer) to bloodlink_ml;
