-- bloodLink donor network, phase 1: the data underneath it (docs/PLANS/plan_donor_network.md,
-- "Data model" and "Eligibility inside the database"). Nothing here sends a message or
-- matches a donor yet.
--
-- * profiles.is_suspended   set by staff only; no client grant
-- * consents                one row per purpose and notice version; written only by
--                           give_consent() and withdraw_consent()
-- * donor_settings          a donor's availability, quiet hours, limits and channels
-- * donor_areas             a donor's home and work areas, rounded to about 1 km
--                           (2 decimals); a PostGIS point is generated from them
-- * donations               centre-confirmed donations (rows come from confirm_donation()
--                           in phase 3; clients can only read their own)
-- * donor_status            computed by triggers, never client-written: in the network or
--                           not, the dates a donor may give between, and the counters
-- * refresh_donor_status()  recomputes one donor's row; its eligibility rules must match
--                           src/lib/eligibility.js (tests/fixtures/eligibility_parity.json)
-- * donor_cell_counts()     admins only: donors per cell, cells with under 5 left out
--
-- Joining needs a complete donor profile and an open donor_network consent. Withdrawing
-- deletes the donor's areas and settings. Every foreign key cascades, so
-- delete_my_account() keeps working. "Today" is India's date, as in the other triggers.

-- ── profiles ─────────────────────────────────────────────────────────────────

alter table public.profiles
  add column is_suspended boolean not null default false;
-- No grant: the existing column-level update grant doesn't include it.

-- ── consents ─────────────────────────────────────────────────────────────────

create table public.consents (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  purpose text not null check (purpose in ('donor_network', 'share_phone_with_centre', 'sms')),
  notice_version text not null check (notice_version ~ '^\d{4}-\d{2}-\d{2}$'),
  given_at timestamptz not null default now(),
  withdrawn_at timestamptz
);
create unique index consents_one_open_per_purpose
  on public.consents (user_id, purpose)
  where withdrawn_at is null;

-- ── donor_settings ───────────────────────────────────────────────────────────

create table public.donor_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  is_available boolean not null default true,
  snoozed_until timestamptz,
  quiet_start time not null default '22:00',
  quiet_end time not null default '07:00',
  critical_overrides_quiet boolean not null default false,
  critical_overrides_gap boolean not null default false,
  max_requests_per_week smallint not null default 2 check (max_requests_per_week between 1 and 7),
  apheresis_willing boolean not null default false,
  channels text[] not null default '{in_app,push}'
    check (cardinality(channels) >= 1 and channels <@ array['in_app', 'push', 'email', 'sms']),
  updated_at timestamptz not null default now()
);

create trigger donor_settings_set_updated_at
  before update on public.donor_settings
  for each row execute function public.set_updated_at();

-- ── donor_areas ──────────────────────────────────────────────────────────────

create table public.donor_areas (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('home', 'work')),
  latitude numeric(5, 2) not null check (latitude between 6 and 37.5),
  longitude numeric(6, 2) not null check (longitude between 68 and 98),
  cell extensions.geography(Point, 4326)
    generated always as (
      extensions.st_setsrid(
        extensions.st_makepoint(longitude::double precision, latitude::double precision), 4326
      )::extensions.geography
    ) stored,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);
create index donor_areas_cell_gist on public.donor_areas using gist (cell);

create trigger donor_areas_set_updated_at
  before update on public.donor_areas
  for each row execute function public.set_updated_at();

-- ── donations ────────────────────────────────────────────────────────────────

create table public.donations (
  id bigint generated always as identity primary key,
  donor_id uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete set null,
  donated_on date not null,
  kind text not null check (kind in ('whole_blood', 'apheresis_platelets', 'apheresis_plasma')),
  request_id bigint, -- foreign key added with blood_requests in phase 2
  source text not null default 'centre_confirmed' check (source in ('centre_confirmed')),
  created_at timestamptz not null default now()
);
create index donations_donor_idx on public.donations (donor_id, donated_on desc);

create or replace function public.donations_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.donated_on > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'A donation date cannot be in the future' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger donations_before_write
  before insert or update on public.donations
  for each row execute function public.donations_before_write();

-- ── donor_status ─────────────────────────────────────────────────────────────

create table public.donor_status (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  blood_group_code text,
  is_in_network boolean not null default false,
  eligible_from date,
  eligible_until date,
  needs_staff_check boolean not null default false,
  screening_confirmed_at timestamptz,
  asks_total integer not null default 0,
  accepts_total integer not null default 0,
  shows_total integer not null default 0,
  ignored_in_a_row integer not null default 0,
  last_asked_at timestamptz,
  updated_at timestamptz not null default now()
);
create index donor_status_group_idx
  on public.donor_status (blood_group_code)
  where is_in_network and eligible_from is not null;

-- ── eligibility, inside the database ─────────────────────────────────────────

-- The birthday of a given age. A 29 February birth has its birthday on 1 March in
-- non-leap years (interval arithmetic would give 28 February).
create or replace function public.birthday_at_age(p_dob date, p_years integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when extract(month from p_dob) = 2 and extract(day from p_dob) = 29
      then make_date((extract(year from p_dob))::integer + p_years, 2, 28) + 1
    else make_date(
      (extract(year from p_dob))::integer + p_years,
      extract(month from p_dob)::integer,
      extract(day from p_dob)::integer
    )
  end;
$$;

-- Recomputes one donor's status row, keeping the counters. Same rules as
-- eligibilityWindow() in src/lib/eligibility.js:
-- * no window when not a donor, no date of birth, a recent tattoo, pregnancy,
--   underweight or a disease, or when it would start after it ends
-- * from: the later of the 18th birthday and the latest donation (self-reported or
--   centre-confirmed) + 90 days for men, 120 days for anyone else
-- * until: the day before the 66th birthday, or the 61st for a first-time donor
-- * needs_staff_check: on medication, which the app doesn't judge
create or replace function public.refresh_donor_status(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_screen public.donor_screening;
  v_latest date;
  v_from date;
  v_until date;
  v_in_network boolean;
begin
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    return; -- the account is being deleted; its status row goes with it
  end if;
  select * into v_screen from public.donor_screening where user_id = p_user_id;
  v_latest := greatest(
    v_screen.last_donation_date,
    (select max(d.donated_on) from public.donations d where d.donor_id = p_user_id)
  );

  if v_profile.is_donor and v_profile.dob is not null
     and not coalesce(v_screen.recent_tattoo or v_screen.pregnant
                      or v_screen.underweight or v_screen.has_disease, false) then
    v_from := greatest(
      public.birthday_at_age(v_profile.dob, 18),
      v_latest + (case when v_profile.gender = 'male' then 90 else 120 end)
    );
    v_until := public.birthday_at_age(v_profile.dob, case when v_latest is null then 61 else 66 end) - 1;
    if v_from > v_until then
      v_from := null;
      v_until := null;
    end if;
  end if;

  v_in_network := v_profile.is_donor and v_profile.is_profile_complete
    and not v_profile.is_suspended
    and exists (
      select 1 from public.consents c
      where c.user_id = p_user_id and c.purpose = 'donor_network' and c.withdrawn_at is null
    );

  insert into public.donor_status as s
    (user_id, blood_group_code, is_in_network, eligible_from, eligible_until,
     needs_staff_check, screening_confirmed_at)
  values
    (p_user_id, v_profile.blood_group_code, v_in_network, v_from, v_until,
     v_profile.is_donor and coalesce(v_screen.on_medication, false), v_screen.updated_at)
  on conflict (user_id) do update
  set blood_group_code = excluded.blood_group_code,
      is_in_network = excluded.is_in_network,
      eligible_from = excluded.eligible_from,
      eligible_until = excluded.eligible_until,
      needs_staff_check = excluded.needs_staff_check,
      screening_confirmed_at = excluded.screening_confirmed_at,
      updated_at = now();
end;
$$;

-- One trigger function for the four source tables; the column that holds the donor's id is
-- passed as the trigger argument. It writes only donor_status, which no trigger watches, so
-- it can't recurse. After a delete the profile may be gone; refresh_donor_status() skips it.
create or replace function public.donor_status_refresh_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := (case tg_op when 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> tg_argv[0];
  if v_user_id is not null then
    perform public.refresh_donor_status(v_user_id);
  end if;
  return null;
end;
$$;

create trigger donor_status_refresh
  after insert or update or delete on public.profiles
  for each row execute function public.donor_status_refresh_trigger('id');
create trigger donor_status_refresh
  after insert or update or delete on public.donor_screening
  for each row execute function public.donor_status_refresh_trigger('user_id');
create trigger donor_status_refresh
  after insert or update or delete on public.donations
  for each row execute function public.donor_status_refresh_trigger('donor_id');
create trigger donor_status_refresh
  after insert or update or delete on public.consents
  for each row execute function public.donor_status_refresh_trigger('user_id');

-- ── consent functions ────────────────────────────────────────────────────────

-- Gives consent for a purpose at a notice version. Joining the network needs a complete
-- donor profile. The same version again does nothing; a new version closes the old row.
create or replace function public.give_consent(p_purpose text, p_notice_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_open public.consents;
begin
  if v_user_id is null then
    raise exception 'Sign in to give consent' using errcode = '42501';
  end if;
  if p_purpose is null or p_purpose not in ('donor_network', 'share_phone_with_centre', 'sms') then
    raise exception 'Unknown consent purpose' using errcode = '22023';
  end if;
  if p_notice_version is null or p_notice_version !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'The notice version must be a date, YYYY-MM-DD' using errcode = '22023';
  end if;
  if p_purpose = 'donor_network' and not exists (
    select 1 from public.profiles
    where id = v_user_id and is_donor and is_profile_complete
  ) then
    raise exception 'Complete your profile and register as a donor first' using errcode = '22023';
  end if;

  select * into v_open from public.consents
  where user_id = v_user_id and purpose = p_purpose and withdrawn_at is null
  for update;
  if found then
    if v_open.notice_version = p_notice_version then
      return;
    end if;
    update public.consents set withdrawn_at = now() where id = v_open.id;
  end if;
  insert into public.consents (user_id, purpose, notice_version)
  values (v_user_id, p_purpose, p_notice_version);
end;
$$;

-- Withdraws consent for a purpose (nothing happens when none is open). Leaving the
-- donor network also deletes the donor's areas and settings.
create or replace function public.withdraw_consent(p_purpose text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Sign in to withdraw consent' using errcode = '42501';
  end if;
  if p_purpose is null or p_purpose not in ('donor_network', 'share_phone_with_centre', 'sms') then
    raise exception 'Unknown consent purpose' using errcode = '22023';
  end if;
  update public.consents set withdrawn_at = now()
  where user_id = v_user_id and purpose = p_purpose and withdrawn_at is null;
  if p_purpose = 'donor_network' then
    delete from public.donor_areas where user_id = v_user_id;
    delete from public.donor_settings where user_id = v_user_id;
  end if;
end;
$$;

-- ── counts for admins ────────────────────────────────────────────────────────

-- In-network donors per cell, and how many of them may give today. Cells with fewer than
-- 5 in-network donors are left out, so a count can't point at a person. A donor with two
-- areas counts in each.
create or replace function public.donor_cell_counts()
returns table (latitude numeric, longitude numeric, donors integer, eligible_today integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.is_admin() then
    raise exception 'Only admins can read donor counts' using errcode = '42501';
  end if;
  return query
  select a.latitude, a.longitude,
         count(*)::integer,
         (count(*) filter (where s.eligible_from <= v_today and v_today <= s.eligible_until))::integer
  from public.donor_areas a
  join public.donor_status s on s.user_id = a.user_id
  where s.is_in_network
  group by a.latitude, a.longitude
  having count(*) >= 5
  order by a.latitude, a.longitude;
end;
$$;

-- ── row-level security ───────────────────────────────────────────────────────

alter table public.consents enable row level security;
alter table public.donor_settings enable row level security;
alter table public.donor_areas enable row level security;
alter table public.donations enable row level security;
alter table public.donor_status enable row level security;

create policy consents_select_own on public.consents
  for select to authenticated using (user_id = (select auth.uid()));

create policy donor_settings_select_own on public.donor_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy donor_settings_delete_own on public.donor_settings
  for delete to authenticated using (user_id = (select auth.uid()));
create policy donor_settings_insert_own on public.donor_settings
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.consents c
      where c.user_id = (select auth.uid()) and c.purpose = 'donor_network' and c.withdrawn_at is null
    )
  );
create policy donor_settings_update_own on public.donor_settings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.consents c
      where c.user_id = (select auth.uid()) and c.purpose = 'donor_network' and c.withdrawn_at is null
    )
  );

create policy donor_areas_select_own on public.donor_areas
  for select to authenticated using (user_id = (select auth.uid()));
create policy donor_areas_delete_own on public.donor_areas
  for delete to authenticated using (user_id = (select auth.uid()));
create policy donor_areas_insert_own on public.donor_areas
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.consents c
      where c.user_id = (select auth.uid()) and c.purpose = 'donor_network' and c.withdrawn_at is null
    )
  );
create policy donor_areas_update_own on public.donor_areas
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.consents c
      where c.user_id = (select auth.uid()) and c.purpose = 'donor_network' and c.withdrawn_at is null
    )
  );

create policy donations_select_own on public.donations
  for select to authenticated using (donor_id = (select auth.uid()));
create policy donations_select_admin on public.donations
  for select to authenticated using ((select public.is_admin()));

create policy donor_status_select_own on public.donor_status
  for select to authenticated using (user_id = (select auth.uid()));

-- ── grants (explicit, so the "expose new tables" setting doesn't matter) ─────

revoke all on public.consents, public.donor_settings, public.donor_areas, public.donations,
  public.donor_status from public, anon, authenticated;

grant select on public.consents to authenticated;

grant select, delete on public.donor_settings to authenticated;
grant insert (user_id, is_available, snoozed_until, quiet_start, quiet_end,
              critical_overrides_quiet, critical_overrides_gap, max_requests_per_week,
              apheresis_willing, channels)
  on public.donor_settings to authenticated;
-- The update grants include the key columns because an upsert (insert ... on conflict do
-- update) from the Data API sets every column it sends; row-level security still keeps
-- user_id the caller's own.
grant update (user_id, is_available, snoozed_until, quiet_start, quiet_end,
              critical_overrides_quiet, critical_overrides_gap, max_requests_per_week,
              apheresis_willing, channels)
  on public.donor_settings to authenticated;

grant select, delete on public.donor_areas to authenticated;
grant insert (user_id, kind, latitude, longitude) on public.donor_areas to authenticated;
grant update (user_id, kind, latitude, longitude) on public.donor_areas to authenticated;

grant select on public.donations to authenticated;
grant select on public.donor_status to authenticated;

revoke execute on function public.donations_before_write() from public, anon, authenticated;
revoke execute on function public.birthday_at_age(date, integer) from public, anon, authenticated;
revoke execute on function public.refresh_donor_status(uuid) from public, anon, authenticated;
revoke execute on function public.donor_status_refresh_trigger() from public, anon, authenticated;
revoke execute on function public.give_consent(text, text) from public, anon;
revoke execute on function public.withdraw_consent(text) from public, anon;
revoke execute on function public.donor_cell_counts() from public, anon;
grant execute on function public.give_consent(text, text) to authenticated;
grant execute on function public.withdraw_consent(text) to authenticated;
grant execute on function public.donor_cell_counts() to authenticated;

-- ── backfill ─────────────────────────────────────────────────────────────────

-- A status row for every existing profile (none is in the network yet).
select public.refresh_donor_status(id) from public.profiles;
