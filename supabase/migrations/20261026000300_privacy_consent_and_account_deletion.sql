-- bloodLink: consent and account deletion (#18)
-- 1. profiles.privacy_version records which version of the privacy note (/privacy)
--    a person agreed to, and privacy_accepted_at when. The trigger sets the time, so
--    a client can only choose the version, which src/lib/privacy.js checks.
-- 2. delete_my_account() lets a signed-in person delete their own account. Deleting
--    the auth user cascades to profiles, donor_screening and their organization
--    applications; audit_log keeps its rows with the actor set to null. The last
--    admin can't delete their account, as set_user_role() won't remove them.
-- create or replace keeps profiles_before_write()'s owner, grants and trigger.

alter table public.profiles
  add column privacy_version text check (privacy_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  add column privacy_accepted_at timestamptz;

grant update (privacy_version) on public.profiles to authenticated;

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
  -- The time of consent comes from the database clock, never from a client.
  if tg_op = 'INSERT' or new.privacy_version is distinct from old.privacy_version then
    new.privacy_accepted_at := case when new.privacy_version is not null then now() end;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  select role into v_role from public.profiles where id = (select auth.uid()) for update;
  if v_role = 'admin' and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'You are the only admin. Make someone else an admin before deleting your account.'
      using errcode = '22023';
  end if;
  delete from auth.users where id = (select auth.uid());
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
