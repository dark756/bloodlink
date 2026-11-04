-- bloodLink: stock-out events an admin makes, and suggestions to eligible donors
-- nearby (docs/PLANS/ML_system.md, Parts C and B, as the closed beta runs them).
--
-- * admin_stock_events   a bank's group marked at risk by an admin, for 24, 48 or
--                        72 hours; real, not a drill. It ends by itself, or earlier
--                        when an admin ends it.
-- * create_admin_event   admins only, audited
-- * end_admin_event      admins only, audited
-- * forecast_marks       now also returns the active events for the banks asked
--                        about, behind the admin_events flag, and whether the
--                        forecast's suggestions to donors (forecast_appeals) are on
--
-- An event is never shown as the forecast: search and the suggestions say
-- "flagged by bloodLink's team". The kill switch leaves admin_events alone.

create table public.admin_stock_events (
  id bigint generated always as identity primary key,
  hospital_code text not null check (hospital_code ~ '^[0-9]{1,10}$'),
  component_id text not null check (component_id ~ '^[0-9]{1,3}$'),
  blood_group_code text not null
    check (blood_group_code in ('11', '12', '13', '14', '15', '16', '17', '18', '22', '23')),
  window_hours smallint not null check (window_hours in (24, 48, 72)),
  reason text not null check (char_length(reason) between 10 and 200),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  ends_at timestamptz not null,
  ended_by uuid references public.profiles (id) on delete set null,
  ended_at timestamptz,
  check (ends_at > created_at),
  check (ended_at is null or ended_at >= created_at)
);
create index admin_stock_events_open
  on public.admin_stock_events (hospital_code, component_id, blood_group_code)
  where ended_at is null;
create index admin_stock_events_created_at on public.admin_stock_events (created_at desc);

-- Marks one bank's group at risk for p_window_hours. The bank must be one bloodLink
-- knows, and the same bank, component and group can't have two active events.
-- Returns the event's id.
create or replace function public.create_admin_event(
  p_hospital_code text,
  p_component_id text,
  p_group_code text,
  p_window_hours integer,
  p_reason text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_reason text := btrim(p_reason);
begin
  if not public.is_admin() then
    raise exception 'Only admins can create stock-out events' using errcode = '42501';
  end if;
  if p_window_hours is null or p_window_hours not in (24, 48, 72) then
    raise exception 'The window must be 24, 48 or 72 hours' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) not between 10 and 200 then
    raise exception 'Give a reason of 10 to 200 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from public.blood_banks where hospital_code = p_hospital_code)
     and not exists (select 1 from public.bank_stock_latest where hospital_code = p_hospital_code) then
    raise exception 'No blood bank has that eRaktKosh code' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('admin_stock_events'));
  if exists (
    select 1 from public.admin_stock_events
    where hospital_code = p_hospital_code and component_id = p_component_id
      and blood_group_code = p_group_code and ended_at is null and ends_at > now()
  ) then
    raise exception 'This bank already has an active event for that component and group'
      using errcode = '22023';
  end if;
  insert into public.admin_stock_events
    (hospital_code, component_id, blood_group_code, window_hours, reason, created_by, ends_at)
  values (p_hospital_code, p_component_id, p_group_code, p_window_hours, v_reason, auth.uid(),
          now() + make_interval(hours => p_window_hours))
  returning id into v_id;
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), 'stock_event.created', 'stock_event', v_id::text,
          jsonb_build_object('hospital_code', p_hospital_code, 'component_id', p_component_id,
            'blood_group_code', p_group_code, 'window_hours', p_window_hours, 'reason', v_reason));
  return v_id;
end;
$$;

-- Ends an active event now, for admins, and writes the audit log.
create or replace function public.end_admin_event(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can end stock-out events' using errcode = '42501';
  end if;
  update public.admin_stock_events
  set ended_at = now(), ended_by = auth.uid()
  where id = p_id and ended_at is null and ends_at > now();
  if not found then
    raise exception 'No active event with that id' using errcode = 'P0002';
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), 'stock_event.ended', 'stock_event', p_id::text, '{}'::jsonb);
end;
$$;

-- What search and the donor suggestions read, for up to 500 banks and one component
-- and group:
--   { showBadge, useInRanking, suggestDonors, showEvents, modelVersion, asOf, cutOff,
--     thresholdUnits, marks: [{ hospitalCode, p, reasons }],
--     events: [{ id, hospitalCode, reason, windowHours, endsAt }] }
-- The forecast's scores come only while one of its flags is on (forecast_badge,
-- forecast_ranking, or forecast_appeals for the suggestions), and the events only
-- while admin_events is on.
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
  v_appeals boolean;
  v_events_on boolean;
  v_model text;
  v_evaluation jsonb;
  v_as_of timestamptz;
  v_cut_off real;
  v_marks jsonb := '[]'::jsonb;
  v_events jsonb := '[]'::jsonb;
begin
  if p_codes is null or cardinality(p_codes) > 500 then
    raise exception 'give at most 500 bank codes' using errcode = '22023';
  end if;
  select coalesce(bool_or(is_enabled) filter (where name = 'forecast_badge'), false),
         coalesce(bool_or(is_enabled) filter (where name = 'forecast_ranking'), false),
         coalesce(bool_or(is_enabled) filter (where name = 'forecast_appeals'), false),
         coalesce(bool_or(is_enabled) filter (where name = 'admin_events'), false)
  into v_badge, v_ranking, v_appeals, v_events_on
  from public.feature_flags;

  if v_events_on then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', e.id, 'hospitalCode', e.hospital_code, 'reason', e.reason,
             'windowHours', e.window_hours, 'endsAt', e.ends_at) order by e.created_at), '[]'::jsonb)
    into v_events
    from public.admin_stock_events e
    where e.ended_at is null and e.ends_at > now()
      and e.component_id = p_component_id and e.blood_group_code = p_group_code
      and e.hospital_code = any (p_codes);
  end if;

  if v_badge or v_ranking or v_appeals then
    select id, evaluation into v_model, v_evaluation from public.model_versions where status = 'live';
  end if;
  if v_model is not null then
    select max(as_of) into v_as_of from public.stock_forecasts
    where model_version = v_model and as_of > now() - interval '12 hours';
  end if;
  if v_as_of is not null then
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
  else
    v_badge := false;
    v_ranking := false;
    v_appeals := false;
  end if;

  return jsonb_build_object(
    'showBadge', v_badge,
    'useInRanking', v_ranking,
    'suggestDonors', v_appeals,
    'showEvents', v_events_on,
    'modelVersion', v_model,
    'asOf', v_as_of,
    'cutOff', v_cut_off,
    'thresholdUnits', coalesce((v_evaluation ->> 'threshold_units')::integer, 0),
    'marks', v_marks,
    'events', v_events);
end;
$$;

-- ── row-level security and grants ────────────────────────────────────────────

alter table public.admin_stock_events enable row level security;
create policy admin_stock_events_select_admin on public.admin_stock_events
  for select to authenticated using (public.is_admin());

revoke all on public.admin_stock_events from public, anon, authenticated;
grant select on public.admin_stock_events to authenticated;

revoke execute on function public.create_admin_event(text, text, text, integer, text),
  public.end_admin_event(bigint) from public, anon;
grant execute on function public.create_admin_event(text, text, text, integer, text),
  public.end_admin_event(bigint) to authenticated;

revoke execute on function public.forecast_marks(text[], text, text) from public;
grant execute on function public.forecast_marks(text[], text, text) to anon, authenticated;
