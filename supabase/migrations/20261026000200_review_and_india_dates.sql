-- bloodLink: two fixes to existing functions
-- 1. The "no future dates" triggers compared with current_date, which is the UTC
--    date on Supabase. Between midnight and 05:30 India time, a date of birth or a
--    last donation of today was refused as being in the future (#46). They now use
--    India's date, as src/lib/profile.js does.
-- 2. review_organization() skipped applicants who were admins entirely, so their
--    organization_id was never set. An admin who later lost the admin role became
--    a plain user although their organization was approved (#42). organization_id is
--    now always set on approval and cleared on rejection or suspension; the role
--    still changes only for non-admins.
-- create or replace keeps each function's owner, grants and triggers.

create or replace function public.profiles_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.dob is not null and new.dob > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Date of birth cannot be in the future' using errcode = '23514';
  end if;
  new.is_profile_complete :=
    new.full_name is not null and new.dob is not null and new.gender is not null
    and new.phone is not null and new.state_code is not null and new.blood_group_code is not null;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.donor_screening_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.last_donation_date is not null
    and new.last_donation_date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Last donation date cannot be in the future' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Approve, reject or suspend an organization application.
-- Approval links the applicant to the organization and gives them its role; anything
-- else removes both. An admin keeps the admin role either way.
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
    set organization_id = v_org.id,
        role = case when role = 'admin' then role else v_org.kind end
    where id = v_org.applicant_id;
  else
    update public.profiles
    set organization_id = null,
        role = case when role = 'admin' then role else 'user' end
    where id = v_org.applicant_id and organization_id = v_org.id;
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

-- Admins approved before this fix: link them to their approved organization.
update public.profiles p
set organization_id = o.id
from public.organizations o
where o.applicant_id = p.id and o.status = 'approved' and p.organization_id is null;
