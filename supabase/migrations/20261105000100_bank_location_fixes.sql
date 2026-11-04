-- bloodLink: corrected positions for banks location search can't place (#33, #34)
-- docs/PLANS/plan_bank_locations.md, Part B.
--
-- eRaktKosh's nearest call gives no position for some stocked banks and a wrong one
-- for others. Their corrected positions live here, apart from blood_banks, because:
-- * the weekly directory run overwrites blood_banks' coordinates every Monday;
-- * the banks with no coordinates have no blood_banks row at all;
-- * every position keeps where it came from and how accurate that source is.
-- /api/blood-search merges accepted fixes into each location search
-- (src/lib/bankLocations.js); BANK_LOCATION_FIXES=off turns that off.
--
-- * scripts/place-banks.mjs writes machine fixes as bloodlink_ingest: 'accepted' when
--   the control run measured its step within 2 km for 90% of banks, else 'proposed'.
-- * Admins accept, move or reject them on /admin/locations, only through
--   review_bank_location(), which writes audit_log.
-- * The weekly directory run marks a machine fix 'superseded' once eRaktKosh gives a
--   usable point within 2 km of it (src/lib/collector.js).
-- * A fix a person confirmed (manual, bank_confirmed) always wins; a machine fix
--   applies only while eRaktKosh's own point is unusable.

create table public.bank_location_fixes (
  hospital_code text primary key check (hospital_code ~ '^[0-9]{1,10}$'),
  state_code text not null check (state_code ~ '^[0-9]{1,3}$'),
  latitude double precision not null check (latitude between 6 and 37.5),
  longitude double precision not null check (longitude between 68 and 97.5),
  -- Why eRaktKosh's own point couldn't be used when the fix was made. corrected: a
  -- person moved a point eRaktKosh had placed usably.
  reason text not null
    check (reason in ('missing', 'wrong_state', 'outside_india', 'shared', 'corrected')),
  method text not null check (method in
    ('eraktkosh_other', 'datagov', 'nominatim_name', 'nominatim_address', 'pincode',
     'manual', 'bank_confirmed')),
  -- The method's 90th-percentile error, measured by the control run.
  precision_m integer not null check (precision_m > 0),
  evidence jsonb not null default '{}'::jsonb, -- query, matched name, OSM id, data.gov.in row
  status text not null default 'proposed'
    check (status in ('proposed', 'accepted', 'rejected', 'superseded')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  location extensions.geography(Point, 4326) generated always as (
    extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography
  ) stored
);
create index bank_location_fixes_location_gist on public.bank_location_fixes using gist (location);
create index bank_location_fixes_status on public.bank_location_fixes (status);

-- ── review ───────────────────────────────────────────────────────────────────

-- An admin's decision on a bank's position:
-- * accepted: a proposed fix goes into search as it is;
-- * moved: the admin's own pin, accepted as a manual fix (for a bank with or
--   without a fix row);
-- * rejected: a fix leaves search;
-- * cant_place: nobody could place the bank; any proposal is rejected, and the
--   decision is logged so the queue can show it.
-- The route checks a moved pin lies in the bank's own state before calling this
-- (src/app/api/admin/locations/review/route.js).
create or replace function public.review_bank_location(
  p_hospital_code text,
  p_decision text,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fix public.bank_location_fixes;
  v_state_code text;
  v_reason text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can review bank locations' using errcode = '42501';
  end if;
  if p_decision not in ('accepted', 'moved', 'rejected', 'cant_place') then
    raise exception 'Decision must be accepted, moved, rejected or cant_place'
      using errcode = '22023';
  end if;
  if p_hospital_code !~ '^[0-9]{1,10}$' then
    raise exception 'Bank code must be digits' using errcode = '22023';
  end if;

  select * into v_fix from public.bank_location_fixes
  where hospital_code = p_hospital_code for update;

  if p_decision = 'moved' then
    if p_latitude is null or p_longitude is null
      or p_latitude not between 6 and 37.5 or p_longitude not between 68 and 97.5 then
      raise exception 'A moved pin needs a position in India' using errcode = '22023';
    end if;
    select s.state_code,
      case
        when b.hospital_code is null or b.latitude is null then 'missing'
        when b.location_quality in ('wrong_state', 'outside_india', 'shared') then b.location_quality
        else 'corrected'
      end
    into v_state_code, v_reason
    from public.bank_stock_latest s
    left join public.blood_banks b using (hospital_code)
    where s.hospital_code = p_hospital_code;
    if not found then
      select b.state_code, coalesce(nullif(b.location_quality, 'ok'), 'corrected')
      into v_state_code, v_reason
      from public.blood_banks b where b.hospital_code = p_hospital_code;
    end if;
    if v_state_code is null then
      raise exception 'Bank not found' using errcode = 'P0002';
    end if;
    insert into public.bank_location_fixes
      (hospital_code, state_code, latitude, longitude, reason, method, precision_m,
       evidence, status, reviewed_by, reviewed_at)
    values
      (p_hospital_code, v_state_code, p_latitude, p_longitude, v_reason, 'manual', 50,
       jsonb_build_object('note', nullif(trim(p_note), '')), 'accepted', auth.uid(), now())
    on conflict (hospital_code) do update set
      state_code = excluded.state_code, latitude = excluded.latitude,
      longitude = excluded.longitude, method = 'manual', precision_m = 50,
      evidence = public.bank_location_fixes.evidence
        || jsonb_build_object('previous', jsonb_build_object(
             'method', public.bank_location_fixes.method,
             'latitude', public.bank_location_fixes.latitude,
             'longitude', public.bank_location_fixes.longitude),
           'note', nullif(trim(p_note), '')),
      status = 'accepted', reviewed_by = auth.uid(), reviewed_at = now();
  elsif p_decision = 'accepted' then
    if v_fix.hospital_code is null then
      raise exception 'No proposed position to accept' using errcode = 'P0002';
    end if;
    update public.bank_location_fixes
    set status = 'accepted', reviewed_by = auth.uid(), reviewed_at = now()
    where hospital_code = p_hospital_code;
  else
    -- rejected, cant_place: any fix leaves search.
    if p_decision = 'rejected' and v_fix.hospital_code is null then
      raise exception 'No position to reject' using errcode = 'P0002';
    end if;
    update public.bank_location_fixes
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
        evidence = evidence || jsonb_build_object('note', nullif(trim(p_note), ''),
                                                  'decision', p_decision)
    where hospital_code = p_hospital_code;
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (
    auth.uid(),
    'bank_location.' || p_decision,
    'blood_bank',
    p_hospital_code,
    jsonb_build_object(
      'previous_status', v_fix.status,
      'previous_method', v_fix.method,
      'previous_latitude', v_fix.latitude,
      'previous_longitude', v_fix.longitude,
      'latitude', p_latitude,
      'longitude', p_longitude,
      'note', nullif(trim(p_note), '')
    )
  );
end;
$$;

-- ── the review queue ─────────────────────────────────────────────────────────

-- Every stocked bank location search can't place, with any fix waiting for review,
-- plus proposed fixes. security_invoker: the caller's row-level security applies, so
-- only an admin sees proposed and rejected fixes. The page sorts it worst first.
create view public.bank_location_queue
with (security_invoker = true) as
select
  s.hospital_code,
  s.state_code,
  coalesce(s.district_id, b.district_id) as district_id,
  coalesce(nullif(s.row->>'hospitalname', ''), b.name) as name,
  coalesce(nullif(s.row->>'hospitaladd', ''), b.address) as address,
  coalesce(s.row->>'type', b.bank_type) as bank_type,
  s.row->'components' as components,
  s.entry_at,
  case
    when b.hospital_code is null or b.latitude is null then 'missing'
    else b.location_quality
  end as location_quality,
  b.latitude as eraktkosh_latitude,
  b.longitude as eraktkosh_longitude,
  f.status as fix_status,
  f.method as fix_method,
  f.latitude as fix_latitude,
  f.longitude as fix_longitude,
  f.precision_m as fix_precision_m,
  f.evidence as fix_evidence,
  f.reviewed_at as fix_reviewed_at
from public.bank_stock_latest s
left join public.blood_banks b using (hospital_code)
left join public.bank_location_fixes f using (hospital_code)
where f.status = 'proposed'
  or ((b.hospital_code is null or b.latitude is null
       or b.location_quality in ('wrong_state', 'outside_india'))
      and (f.status is null or f.status = 'rejected'));

-- ── access ───────────────────────────────────────────────────────────────────

alter table public.bank_location_fixes enable row level security;

-- Bank positions are public, as in blood_banks, once accepted.
create policy bank_location_fixes_read_accepted on public.bank_location_fixes
  for select to anon, authenticated using (status = 'accepted');
create policy bank_location_fixes_read_admin on public.bank_location_fixes
  for select to authenticated using ((select public.is_admin()));
-- The ingest role sees every row, adds machine fixes, and moves them between
-- proposed, accepted and superseded. It can't make or change a human-confirmed fix.
create policy bank_location_fixes_ingest_read on public.bank_location_fixes
  for select to bloodlink_ingest using (true);
create policy bank_location_fixes_ingest_insert on public.bank_location_fixes
  for insert to bloodlink_ingest
  with check (method not in ('manual', 'bank_confirmed')
              and status in ('proposed', 'accepted') and reviewed_at is null);
create policy bank_location_fixes_ingest_update on public.bank_location_fixes
  for update to bloodlink_ingest
  using (method not in ('manual', 'bank_confirmed') and reviewed_at is null)
  with check (method not in ('manual', 'bank_confirmed')
              and status in ('proposed', 'accepted', 'superseded') and reviewed_at is null);

revoke all on public.bank_location_fixes, public.bank_location_queue
  from public, anon, authenticated;
grant select on public.bank_location_fixes to anon, authenticated;
grant select on public.bank_location_queue to authenticated;
-- SELECT too, because an UPDATE ... WHERE and an ON CONFLICT read the row: a missing
-- grant of exactly this kind kept the weekly prune from ever running (#56).
grant select, insert, update on public.bank_location_fixes to bloodlink_ingest;

revoke execute on function public.review_bank_location(text, text, double precision,
  double precision, text) from public, anon;
grant execute on function public.review_bank_location(text, text, double precision,
  double precision, text) to authenticated;
