-- bloodLink initial schema
-- profiles (one per auth user), donor screening answers, organization
-- verification (hospitals and blood banks), and an audit log.
--
-- Security model:
-- * Row-level security on every table, plus column-level grants, so the public
--   Data API can't be used to change roles or verification status.
-- * Roles change only through review_organization() and set_user_role(), which
--   check is_admin() and write to audit_log.
-- * Health answers live in donor_screening, readable only by their owner.

-- ── helpers ──────────────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── tables ───────────────────────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text check (char_length(full_name) between 1 and 100),
  dob date check (dob > date '1900-01-01'),
  gender text check (gender in ('male', 'female', 'other')),
  phone text check (phone ~ '^\+?[0-9 -]{7,20}$'),
  state_code text check (state_code ~ '^[0-9]{1,3}$'),
  district_code text check (district_code ~ '^[0-9]{1,4}$'),
  emergency_name text check (char_length(emergency_name) <= 100),
  emergency_phone text check (emergency_phone ~ '^\+?[0-9 -]{7,20}$'),
  -- eRaktKosh blood-group codes: 11 A+, 12 A-, 13 B+, 14 B-, 15 O+, 16 O-,
  -- 17 AB+, 18 AB-, 22 Bombay Oh+, 23 Bombay Oh-
  blood_group_code text check (blood_group_code in ('11', '12', '13', '14', '15', '16', '17', '18', '22', '23')),
  is_donor boolean not null default false,
  is_profile_complete boolean not null default false, -- maintained by trigger
  role text not null default 'user' check (role in ('user', 'hospital', 'blood_bank', 'admin')),
  organization_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.donor_screening (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  last_donation_date date,
  donation_camp text check (char_length(donation_camp) <= 100),
  recent_tattoo boolean not null default false,
  pregnant boolean not null default false,
  underweight boolean not null default false,
  on_medication boolean not null default false,
  medication_details text check (char_length(medication_details) <= 200),
  has_disease boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('hospital', 'blood_bank')),
  name text not null check (char_length(name) between 2 and 200),
  registration_number text not null check (char_length(registration_number) between 2 and 100),
  eraktkosh_code text check (eraktkosh_code ~ '^[0-9]{1,10}$'),
  state_code text not null check (state_code ~ '^[0-9]{1,3}$'),
  district_code text check (district_code ~ '^[0-9]{1,4}$'),
  address text not null check (char_length(address) between 5 and 500),
  phone text not null check (phone ~ '^\+?[0-9 -]{7,20}$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'suspended')),
  applicant_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  review_note text check (char_length(review_note) <= 500),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One open (pending or approved) application per person.
create unique index organizations_one_open_per_applicant
  on public.organizations (applicant_id)
  where status in ('pending', 'approved');
create index organizations_status_idx on public.organizations (status, created_at desc);

alter table public.profiles
  add constraint profiles_organization_id_fkey
  foreign key (organization_id) references public.organizations (id) on delete set null;

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_created_at_idx on public.audit_log (created_at desc);

-- ── triggers ─────────────────────────────────────────────────────────────────

-- Validates profile values that CHECK constraints can't express and keeps
-- is_profile_complete in sync, so clients can't set it directly.
create or replace function public.profiles_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.dob is not null and new.dob > current_date then
    raise exception 'Date of birth cannot be in the future' using errcode = '23514';
  end if;
  new.is_profile_complete :=
    new.full_name is not null and new.dob is not null and new.gender is not null
    and new.phone is not null and new.state_code is not null and new.blood_group_code is not null;
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_before_write
  before insert or update on public.profiles
  for each row execute function public.profiles_before_write();

create or replace function public.donor_screening_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.last_donation_date is not null and new.last_donation_date > current_date then
    raise exception 'Last donation date cannot be in the future' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger donor_screening_before_write
  before insert or update on public.donor_screening
  for each row execute function public.donor_screening_before_write();

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- A profile row for every new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), 100), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- Backfill profiles for any users created before this migration.
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- ── role checks and admin actions ────────────────────────────────────────────

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- Approve, reject or suspend an organization application.
-- Approval gives the applicant the organization's role; anything else removes it.
create or replace function public.review_organization(
  p_organization_id uuid,
  p_decision text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
begin
  if not public.is_admin() then
    raise exception 'Only admins can review organizations' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected', 'suspended') then
    raise exception 'Decision must be approved, rejected or suspended' using errcode = '22023';
  end if;

  select * into v_org from public.organizations where id = p_organization_id for update;
  if not found then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;

  update public.organizations
  set status = p_decision,
      review_note = nullif(trim(p_note), ''),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_organization_id;

  if p_decision = 'approved' then
    update public.profiles
    set role = v_org.kind, organization_id = v_org.id
    where id = v_org.applicant_id and role <> 'admin';
  else
    update public.profiles
    set role = 'user', organization_id = null
    where id = v_org.applicant_id and organization_id = v_org.id and role <> 'admin';
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (
    auth.uid(),
    'organization.' || p_decision,
    'organization',
    p_organization_id::text,
    jsonb_build_object(
      'name', v_org.name,
      'kind', v_org.kind,
      'previous_status', v_org.status,
      'applicant_id', v_org.applicant_id,
      'note', nullif(trim(p_note), '')
    )
  );
end;
$$;

-- Grant or remove the admin role. Hospital and blood-bank roles come only from
-- organization review. The last admin can't remove themselves.
create or replace function public.set_user_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_role text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change roles' using errcode = '42501';
  end if;
  if p_role not in ('user', 'admin') then
    raise exception 'Role must be user or admin' using errcode = '22023';
  end if;

  select role into v_old_role from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  if v_old_role = p_role then
    return;
  end if;
  if v_old_role = 'admin' and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'Cannot remove the last admin' using errcode = '22023';
  end if;

  -- Removing admin from someone who also holds an approved organization gives
  -- them back that organization's role.
  update public.profiles p
  set role = case
    when p_role = 'user' and p.organization_id is not null then
      coalesce((select o.kind from public.organizations o where o.id = p.organization_id and o.status = 'approved'), 'user')
    else p_role
  end
  where p.id = p_user_id;

  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), 'user.role_changed', 'user', p_user_id::text,
          jsonb_build_object('from', v_old_role, 'to', p_role));
end;
$$;

-- ── row-level security ───────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.donor_screening enable row level security;
alter table public.organizations enable row level security;
alter table public.audit_log enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_select_admin on public.profiles
  for select to authenticated using ((select public.is_admin()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy donor_screening_owner on public.donor_screening
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy organizations_select_own_or_admin on public.organizations
  for select to authenticated
  using (applicant_id = (select auth.uid()) or (select public.is_admin()));
create policy organizations_insert_own on public.organizations
  for insert to authenticated
  with check (applicant_id = (select auth.uid()) and status = 'pending');
create policy organizations_update_own_pending on public.organizations
  for update to authenticated
  using (applicant_id = (select auth.uid()) and status = 'pending')
  with check (applicant_id = (select auth.uid()) and status = 'pending');

create policy audit_log_select_admin on public.audit_log
  for select to authenticated using ((select public.is_admin()));

-- ── grants (explicit, so the "expose new tables" setting doesn't matter) ─────

revoke all on public.profiles, public.donor_screening, public.organizations, public.audit_log
  from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, dob, gender, phone, state_code, district_code,
              emergency_name, emergency_phone, blood_group_code, is_donor)
  on public.profiles to authenticated;

grant select, insert, update, delete on public.donor_screening to authenticated;

grant select on public.organizations to authenticated;
grant insert (kind, name, registration_number, eraktkosh_code, state_code, district_code, address, phone)
  on public.organizations to authenticated;
grant update (name, registration_number, eraktkosh_code, state_code, district_code, address, phone)
  on public.organizations to authenticated;

grant select on public.audit_log to authenticated;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_user_email_change() from public, anon, authenticated;
revoke execute on function public.profiles_before_write() from public, anon, authenticated;
revoke execute on function public.donor_screening_before_write() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.review_organization(uuid, text, text) from public, anon;
revoke execute on function public.set_user_role(uuid, text) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.review_organization(uuid, text, text) to authenticated;
grant execute on function public.set_user_role(uuid, text) to authenticated;
