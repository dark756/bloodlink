-- bloodLink donor network, phase 3: live requests, in-app only (docs/PLANS/plan_donor_network.md,
-- "Phase 3 and 4 build spec", S19 to S25 and S29 to S35). Nothing here sends a message: a donor
-- finds out about a request only by opening the site, through my_request_cards().
--
-- * blood_requests.mode            widens to 'shadow' and 'live'; paused_at holds a request an abuse
--                                  report has stopped for review
-- * organization_live_flags        which organizations raise live requests (S19), set by
--                                  set_organization_live() (admins, audited)
-- * request_responses              check_in_code, hold_until, share_phone and deferral_reason.
--                                  Donors have no select on it, on any column (S20); admins read it
--                                  through admin_request_responses()
-- * donor_card_signals             one row per donor holding only the time their cards last changed;
--                                  the only table a page subscribes to (S35). Triggers on
--                                  request_responses and blood_requests write it, and only for live
--                                  requests
-- * my_request_cards()             the caller's live cards, without the patient reference (S31, S34)
-- * respond(), cancel_response(), check_in(), mark_card_seen()   a donor's own actions (S21)
-- * confirm_donation(), defer_donor()   members of the anchor organization (S22)
-- * request_donor_contacts()       the accepted donors' contact details, each reveal logged in
--                                  contact_reveals (S25)
-- * abuse_reports                  donors report a request; a report about money pauses it
-- * review_abuse_report(), set_user_suspended(), set_organization_live()   admins, audited
-- * create_request() and advance_requests() are replaced: a request is live only for an
--   organization with the flag on, and live requests get hold timeouts and response expiry.
--   Shadow requests behave exactly as before.
--
-- Live counters (S23): a live ask adds to asks_total and sets last_asked_at; accepting adds to
-- accepts_total; a donation or a deferral adds to shows_total. A card the donor opened and left
-- until the request ended or passed needed_by adds to ignored_in_a_row; one they never opened
-- never does, and answering resets it. Three in a row snooze the donor for 30 days. Every function is security definer with
-- an empty search_path and takes the caller from auth.uid().

-- ── blood_requests ───────────────────────────────────────────────────────────

alter table public.blood_requests drop constraint blood_requests_mode_check;
alter table public.blood_requests
  add constraint blood_requests_mode_check check (mode in ('shadow', 'live'));
alter table public.blood_requests add column paused_at timestamptz;

-- ── organization_live_flags ──────────────────────────────────────────────────

create table public.organization_live_flags (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  is_live boolean not null default false,
  critical_outside_hours boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ── request_responses ────────────────────────────────────────────────────────

alter table public.request_responses
  add column check_in_code text check (char_length(check_in_code) = 6),
  add column hold_until timestamptz,
  add column share_phone boolean not null default false,
  add column deferral_reason text check (char_length(deferral_reason) between 1 and 200);

-- ── donor_card_signals ───────────────────────────────────────────────────────

create table public.donor_card_signals (
  donor_id uuid primary key references auth.users (id) on delete cascade,
  changed_at timestamptz not null
);

-- ── contact_reveals ──────────────────────────────────────────────────────────

create table public.contact_reveals (
  id bigint generated always as identity primary key,
  -- A reveal is removed with its request and response, and its revealed_by is nulled when that
  -- person's account goes. Deleting a person can do both to one row, so the two cascading keys
  -- are checked at the end of the statement, when the row has already gone.
  request_id bigint not null references public.blood_requests (id) on delete cascade
    deferrable initially deferred,
  response_id bigint not null references public.request_responses (id) on delete cascade
    deferrable initially deferred,
  donor_id uuid not null references public.profiles (id) on delete cascade,
  revealed_by uuid references public.profiles (id) on delete set null,
  phone_shared boolean not null,
  revealed_at timestamptz not null default now()
);
create index contact_reveals_donor_idx on public.contact_reveals (donor_id, revealed_at desc);
create index contact_reveals_request_idx on public.contact_reveals (request_id);

-- A donation is nulled twice when its organization's applicant is deleted: by its request and by
-- its organization. The request key is checked at the end of the statement, when both are done.
alter table public.donations alter constraint donations_request_id_fkey deferrable initially deferred;

-- ── abuse_reports ────────────────────────────────────────────────────────────

create table public.abuse_reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  request_id bigint not null references public.blood_requests (id) on delete cascade,
  kind text not null check (kind in ('money', 'harassment', 'other')),
  details text check (char_length(details) between 1 and 500 and details !~ '[[:cntrl:]]'),
  status text not null default 'open' check (status in ('open', 'dismissed', 'upheld')),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (char_length(review_note) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (reporter_id, request_id)
);
create index abuse_reports_open_idx on public.abuse_reports (created_at) where status = 'open';

-- ── helpers ──────────────────────────────────────────────────────────────────

-- Whether the caller was asked for a live request (the abuse report policy needs it, and the
-- caller can't read request_responses).
create or replace function public.was_asked_for_request(p_request_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.request_responses r
    join public.blood_requests b on b.id = r.request_id
    where r.request_id = p_request_id and r.donor_id = (select auth.uid()) and b.mode = 'live'
  );
$$;

-- Whether the caller is a member of the request's organization (approved, not suspended).
create or replace function public.is_request_member(p_request_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.blood_requests b
    join public.organizations o on o.id = b.organization_id
    join public.profiles p on p.organization_id = o.id
    where b.id = p_request_id and p.id = (select auth.uid())
      and o.status = 'approved' and not p.is_suspended
  );
$$;

-- Moves every given donor's signal row to the present. clock_timestamp(), so two changes in one
-- transaction still differ. A donor whose account is going is skipped.
create or replace function public.touch_card_signals(p_donor_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.donor_card_signals (donor_id, changed_at)
  select u.id, clock_timestamp()
  from auth.users u
  where u.id = any (p_donor_ids)
  on conflict (donor_id) do update set changed_at = excluded.changed_at;
$$;

-- Adds one ignored request to each given donor, then snoozes (30 days) and resets any donor who
-- has reached three in a row.
create or replace function public.bump_ignored(p_donor_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(cardinality(p_donor_ids), 0) = 0 then
    return;
  end if;
  update public.donor_status
  set ignored_in_a_row = ignored_in_a_row + 1, updated_at = now()
  where user_id = any (p_donor_ids);
  update public.donor_settings
  set snoozed_until = now() + interval '30 days'
  where user_id in (
    select s.user_id from public.donor_status s
    where s.user_id = any (p_donor_ids) and s.ignored_in_a_row >= 3
  );
  update public.donor_status
  set ignored_in_a_row = 0
  where user_id = any (p_donor_ids) and ignored_in_a_row >= 3;
end;
$$;

-- ── triggers ─────────────────────────────────────────────────────────────────

-- A live ask adds to the donor's counters (S23), and any change to a live response moves the
-- donor's signal (S35). A shadow request touches neither. Deleting a response does nothing: a
-- delete only comes with a donor's or a request's removal.
create or replace function public.request_responses_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
begin
  select b.mode into v_mode from public.blood_requests b where b.id = new.request_id;
  if v_mode is distinct from 'live' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    update public.donor_status
    set asks_total = asks_total + 1, last_asked_at = now(), updated_at = now()
    where user_id = new.donor_id;
  elsif old.status is not distinct from new.status then
    return null;
  end if;
  perform public.touch_card_signals(array[new.donor_id]);
  return null;
end;
$$;

create trigger request_responses_after_write
  after insert or update on public.request_responses
  for each row execute function public.request_responses_after_write();

-- When a live request is covered or closes, the responses still waiting are settled (Step 4):
-- covered, fulfilled and cancelled make them not_needed, which never counts against a donor; a
-- request that ends unfilled (or passes needed_by) expires them, and a card the donor had opened
-- and never answered counts as ignored.
-- Acceptances still on hold end as not_needed when the request closes.
create or replace function public.blood_requests_live_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.mode <> 'live' or new.status = old.status then
    return null;
  end if;
  if new.status = 'covered' then
    update public.request_responses set status = 'not_needed'
    where request_id = new.id and status in ('notified', 'seen');
  elsif new.status in ('fulfilled', 'cancelled') then
    update public.request_responses set status = 'not_needed'
    where request_id = new.id and status in ('notified', 'seen', 'accepted');
  elsif new.status in ('expired', 'partly_fulfilled') then
    perform public.bump_ignored(array(
      select r.donor_id from public.request_responses r
      where r.request_id = new.id and r.status = 'seen'
    ));
    update public.request_responses set status = 'expired'
    where request_id = new.id and status in ('notified', 'seen');
    update public.request_responses set status = 'not_needed'
    where request_id = new.id and status = 'accepted';
  end if;
  return null;
end;
$$;

create trigger blood_requests_live_status_change
  after update of status on public.blood_requests
  for each row execute function public.blood_requests_live_status_change();

-- A second report of the same request by the same donor is refused with its own SQLSTATE (BL001),
-- so the app can say so plainly instead of reading the unique violation (23505) as something else.
create or replace function public.abuse_reports_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.abuse_reports a
    where a.reporter_id = new.reporter_id and a.request_id = new.request_id
  ) then
    raise exception 'You have already reported this request' using errcode = 'BL001';
  end if;
  return new;
end;
$$;

create trigger abuse_reports_before_insert
  before insert on public.abuse_reports
  for each row execute function public.abuse_reports_before_insert();

-- A money report pauses its request for review: no more waves and no cards (S29).
create or replace function public.abuse_reports_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'money' then
    update public.blood_requests
    set paused_at = coalesce(paused_at, now())
    where id = new.request_id and status in ('open', 'covered');
    perform public.touch_card_signals(array(
      select r.donor_id from public.request_responses r where r.request_id = new.request_id
    ));
  end if;
  return null;
end;
$$;

create trigger abuse_reports_after_insert
  after insert on public.abuse_reports
  for each row execute function public.abuse_reports_after_insert();

-- ── row-level security ───────────────────────────────────────────────────────

alter table public.organization_live_flags enable row level security;
alter table public.donor_card_signals enable row level security;
alter table public.contact_reveals enable row level security;
alter table public.abuse_reports enable row level security;

-- Donors read nothing of request_responses (S20); admins read it through a function.
drop policy request_responses_select_admin on public.request_responses;

create policy organization_live_flags_select_admin on public.organization_live_flags
  for select to authenticated using ((select public.is_admin()));

create policy donor_card_signals_select_own on public.donor_card_signals
  for select to authenticated using (donor_id = (select auth.uid()));

create policy contact_reveals_select_own on public.contact_reveals
  for select to authenticated using (donor_id = (select auth.uid()));
create policy contact_reveals_select_admin on public.contact_reveals
  for select to authenticated using ((select public.is_admin()));

create policy abuse_reports_insert_own on public.abuse_reports
  for insert to authenticated
  with check (reporter_id = (select auth.uid()) and public.was_asked_for_request(request_id));
create policy abuse_reports_select_own on public.abuse_reports
  for select to authenticated using (reporter_id = (select auth.uid()));
create policy abuse_reports_select_admin on public.abuse_reports
  for select to authenticated using ((select public.is_admin()));

-- ── set_organization_live ────────────────────────────────────────────────────

-- Turns live requests on or off for an approved organization (S19). Admins only; audited.
create or replace function public.set_organization_live(
  p_organization_id uuid,
  p_is_live boolean,
  p_critical_outside_hours boolean default null
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
    raise exception 'Only admins can change an organization''s live setting' using errcode = '42501';
  end if;
  if p_is_live is null then
    raise exception 'Choose on or off' using errcode = '22023';
  end if;
  select * into v_org from public.organizations where id = p_organization_id;
  if not found then
    raise exception 'No such organization' using errcode = 'P0002';
  end if;
  if p_is_live and v_org.status <> 'approved' then
    raise exception 'Only an approved organization can raise live requests' using errcode = '22023';
  end if;
  insert into public.organization_live_flags
    (organization_id, is_live, critical_outside_hours, updated_by)
  values (p_organization_id, p_is_live, coalesce(p_critical_outside_hours, false), auth.uid())
  on conflict (organization_id) do update
  set is_live = excluded.is_live,
      critical_outside_hours = coalesce(p_critical_outside_hours,
                                        public.organization_live_flags.critical_outside_hours),
      updated_by = excluded.updated_by, updated_at = now();
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), 'organization.live_' || case when p_is_live then 'on' else 'off' end,
          'organization', p_organization_id::text, jsonb_build_object('name', v_org.name));
end;
$$;

-- ── set_user_suspended ───────────────────────────────────────────────────────

-- Suspends or reinstates a user (S29). A suspended user leaves the network and can't raise
-- requests. Admins only, never themselves; audited.
create or replace function public.set_user_suspended(
  p_user_id uuid,
  p_is_suspended boolean,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(p_reason);
begin
  if not public.is_admin() then
    raise exception 'Only admins can suspend a user' using errcode = '42501';
  end if;
  if p_is_suspended is null then
    raise exception 'Choose suspend or reinstate' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) not between 1 and 200 then
    raise exception 'Give a reason of 1 to 200 characters' using errcode = '22023';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You can''t suspend yourself' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'No such user' using errcode = 'P0002';
  end if;
  update public.profiles set is_suspended = p_is_suspended where id = p_user_id;
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), case when p_is_suspended then 'user.suspended' else 'user.reinstated' end,
          'user', p_user_id::text, jsonb_build_object('reason', v_reason));
end;
$$;

-- ── review_abuse_report ──────────────────────────────────────────────────────

-- Closes a report. Dismissed lifts the request's pause when no other money report is open;
-- upheld cancels the request if it is still open. Admins only; audited.
create or replace function public.review_abuse_report(
  p_report_id bigint,
  p_decision text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.abuse_reports;
  v_note text := nullif(btrim(p_note), '');
begin
  if not public.is_admin() then
    raise exception 'Only admins can review reports' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('dismissed', 'upheld') then
    raise exception 'Choose dismissed or upheld' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    raise exception 'The note can be at most 200 characters' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('bloodlink.match_wave'));
  select * into v_report from public.abuse_reports where id = p_report_id for update;
  if not found then
    raise exception 'No such report' using errcode = 'P0002';
  end if;
  if v_report.status <> 'open' then
    raise exception 'The report is already reviewed' using errcode = '22023';
  end if;
  update public.abuse_reports
  set status = p_decision, reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note
  where id = p_report_id;
  if p_decision = 'dismissed' then
    if not exists (
      select 1 from public.abuse_reports a
      where a.request_id = v_report.request_id and a.kind = 'money' and a.status = 'open'
    ) then
      update public.blood_requests set paused_at = null where id = v_report.request_id;
      perform public.touch_card_signals(array(
        select r.donor_id from public.request_responses r where r.request_id = v_report.request_id
      ));
    end if;
  else
    update public.blood_requests
    set status = 'cancelled', closed_at = now(), close_reason = 'Abuse report upheld'
    where id = v_report.request_id and status in ('open', 'covered');
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), 'abuse_report.' || p_decision, 'abuse_report', p_report_id::text,
          jsonb_build_object('request_id', v_report.request_id, 'kind', v_report.kind));
end;
$$;

-- ── admin_request_responses ──────────────────────────────────────────────────

-- The responses of one request, for admins (the table itself has no client grant).
create or replace function public.admin_request_responses(p_request_id bigint)
returns table (
  response_id bigint,
  donor_id uuid,
  wave integer,
  score double precision,
  est_minutes double precision,
  is_exact_group boolean,
  status text,
  hold_until timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Only admins can read responses' using errcode = '42501';
  end if;
  return query
  select r.id, r.donor_id, r.wave::integer, r.score, r.est_minutes, r.is_exact_group, r.status,
         r.hold_until, r.created_at, r.updated_at
  from public.request_responses r
  where r.request_id = p_request_id
  order by r.id;
end;
$$;

-- ── my_request_cards ─────────────────────────────────────────────────────────

-- The caller's cards (S31, S34): live requests that are open or covered and not paused, for
-- responses in notified, seen or accepted, while the caller is in the network. The distance is
-- a band from the caller's nearest area to the centre (5, 10, 15, 25 km or beyond), never a
-- number or a position. After acceptance the centre's address, phone, position (for a map
-- link) and the check-in code come too (S32). The patient reference is never returned.
create or replace function public.my_request_cards()
returns table (
  request_id bigint,
  response_status text,
  urgency text,
  blood_group_code text,
  component_id text,
  centre_name text,
  distance_band text,
  needed_by timestamptz,
  hold_until timestamptz,
  centre_address text,
  centre_phone text,
  centre_latitude double precision,
  centre_longitude double precision,
  check_in_code text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  return query
  select r.request_id, r.status, b.urgency, b.blood_group_code, b.component_id, k.name,
         case
           when d.meters is null then 'beyond'
           when d.meters <= 5000 then '5'
           when d.meters <= 10000 then '10'
           when d.meters <= 15000 then '15'
           when d.meters <= 25000 then '25'
           else 'beyond'
         end,
         b.needed_by,
         case when r.status = 'accepted' then r.hold_until end,
         case when r.status = 'accepted' then k.address end,
         case when r.status = 'accepted' then k.phone end,
         case when r.status = 'accepted'
              then extensions.st_y(b.anchor_point::extensions.geometry) end,
         case when r.status = 'accepted'
              then extensions.st_x(b.anchor_point::extensions.geometry) end,
         case when r.status = 'accepted' then r.check_in_code end
  from public.request_responses r
  join public.blood_requests b on b.id = r.request_id
  join public.blood_banks k on k.hospital_code = b.anchor_hospital_code
  join public.donor_status s on s.user_id = r.donor_id
  left join lateral (
    select min(extensions.st_distance(a.cell, b.anchor_point)) as meters
    from public.donor_areas a
    where a.user_id = r.donor_id
  ) d on true
  where r.donor_id = v_user
    and b.mode = 'live'
    and b.status in ('open', 'covered')
    and b.paused_at is null
    and b.needed_by > now()
    and r.status in ('notified', 'seen', 'accepted')
    and s.is_in_network
  order by case b.urgency when 'critical' then 0 when 'urgent' then 1 else 2 end,
           b.needed_by, r.request_id;
end;
$$;

-- ── donor actions ────────────────────────────────────────────────────────────

-- Opening a card (expanding it) marks it seen (S31). Nothing happens for a card that isn't
-- waiting. The popup opening and "not now" never call this.
create or replace function public.mark_card_seen(p_request_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  update public.request_responses r
  set status = 'seen'
  from public.blood_requests b
  where r.request_id = p_request_id and r.donor_id = v_user and r.status = 'notified'
    and b.id = r.request_id and b.mode = 'live' and b.status in ('open', 'covered')
    and b.paused_at is null and b.needed_by > now();
end;
$$;

-- Accepts or declines the caller's own card (S21). Accepting holds a place until hold_until
-- (S24, assumptions): the estimated travel plus 60 minutes for a critical request, plus 2 hours
-- for an urgent one, and needed_by for a routine one. It makes the check-in code, records
-- whether the caller consented to share their number with the centre, and counts as an accept.
-- Either answer resets ignored_in_a_row. Asking again with the same answer does nothing.
create or replace function public.respond(p_request_id bigint, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_req public.blood_requests;
  v_resp public.request_responses;
  v_hold timestamptz;
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_accept is null then
    raise exception 'Choose accept or decline' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('bloodlink.match_wave'));
  select * into v_resp from public.request_responses
  where request_id = p_request_id and donor_id = v_user for update;
  if not found then
    raise exception 'No such request card' using errcode = 'P0002';
  end if;
  select * into v_req from public.blood_requests where id = p_request_id;
  if v_req.mode <> 'live' then
    raise exception 'No such request card' using errcode = 'P0002';
  end if;
  if (p_accept and v_resp.status = 'accepted') or (not p_accept and v_resp.status = 'declined') then
    return;
  end if;
  if v_resp.status not in ('notified', 'seen') then
    raise exception 'This request can no longer be answered' using errcode = '22023';
  end if;
  if v_req.status not in ('open', 'covered') or v_req.paused_at is not null
     or now() >= v_req.needed_by then
    raise exception 'This request is closed' using errcode = '22023';
  end if;

  if p_accept then
    if not exists (select 1 from public.donor_status s where s.user_id = v_user and s.is_in_network) then
      raise exception 'Join the donor network to accept a request' using errcode = '42501';
    end if;
    v_hold := case v_req.urgency
      when 'critical' then now() + make_interval(mins => ceil(v_resp.est_minutes)::integer + 60)
      when 'urgent' then now() + make_interval(mins => ceil(v_resp.est_minutes)::integer)
                         + interval '2 hours'
      else v_req.needed_by
    end;
    update public.request_responses
    set status = 'accepted',
        hold_until = v_hold,
        check_in_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
        share_phone = exists (
          select 1 from public.consents c
          where c.user_id = v_user and c.purpose = 'share_phone_with_centre'
            and c.withdrawn_at is null
        )
    where id = v_resp.id;
    update public.donor_status
    set accepts_total = accepts_total + 1, ignored_in_a_row = 0, updated_at = now()
    where user_id = v_user;
  else
    update public.request_responses set status = 'declined' where id = v_resp.id;
    update public.donor_status
    set ignored_in_a_row = 0, updated_at = now()
    where user_id = v_user;
  end if;
end;
$$;

-- The caller can't come after all: an accepted place is given up. The request goes back to
-- open at the next advance_requests() if it needs the donor.
create or replace function public.cancel_response(p_request_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_resp public.request_responses;
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('bloodlink.match_wave'));
  select r.* into v_resp
  from public.request_responses r
  join public.blood_requests b on b.id = r.request_id
  where r.request_id = p_request_id and r.donor_id = v_user and b.mode = 'live'
  for update of r;
  if not found then
    raise exception 'No such request card' using errcode = 'P0002';
  end if;
  if v_resp.status = 'cancelled' then
    return;
  end if;
  if v_resp.status <> 'accepted' then
    raise exception 'Only an accepted place can be cancelled' using errcode = '22023';
  end if;
  update public.request_responses set status = 'cancelled' where id = v_resp.id;
end;
$$;

-- The caller arrives at the centre and gives the code shown on their card (S24): the response
-- moves to arrived. A wrong code, or a hold that has run out, is refused.
create or replace function public.check_in(p_request_id bigint, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_resp public.request_responses;
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('bloodlink.match_wave'));
  select r.* into v_resp
  from public.request_responses r
  join public.blood_requests b on b.id = r.request_id
  where r.request_id = p_request_id and r.donor_id = v_user and b.mode = 'live'
  for update of r;
  if not found then
    raise exception 'No such request card' using errcode = 'P0002';
  end if;
  if v_resp.status = 'arrived' then
    return;
  end if;
  if v_resp.status <> 'accepted' then
    raise exception 'Only an accepted place can be checked in' using errcode = '22023';
  end if;
  if v_resp.hold_until is not null and v_resp.hold_until < now() then
    raise exception 'Your place has run out' using errcode = '22023';
  end if;
  if p_code is null or upper(btrim(p_code)) <> v_resp.check_in_code then
    raise exception 'That code does not match' using errcode = '22023';
  end if;
  update public.request_responses set status = 'arrived' where id = v_resp.id;
end;
$$;

-- ── centre actions ───────────────────────────────────────────────────────────

-- A member of the anchor organization confirms a donation (S22): a donations row, the response
-- to donated, a show for the donor, and a unit on the request. The request's own status follows
-- at the next advance_requests().
create or replace function public.confirm_donation(p_response_id bigint, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_resp public.request_responses;
  v_req public.blood_requests;
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('whole_blood', 'apheresis_platelets', 'apheresis_plasma') then
    raise exception 'Unknown donation kind' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('bloodlink.match_wave'));
  select * into v_resp from public.request_responses where id = p_response_id for update;
  if not found then
    raise exception 'No such response' using errcode = 'P0002';
  end if;
  select * into v_req from public.blood_requests where id = v_resp.request_id;
  if v_req.mode <> 'live' or not public.is_request_member(v_req.id) then
    raise exception 'Only a member of the raising organization can confirm a donation'
      using errcode = '42501';
  end if;
  if v_resp.status not in ('accepted', 'arrived') then
    raise exception 'Only an accepted donor can be confirmed' using errcode = '22023';
  end if;

  update public.request_responses set status = 'donated' where id = v_resp.id;
  insert into public.donations (donor_id, organization_id, donated_on, kind, request_id)
  values (v_resp.donor_id, v_req.organization_id, (now() at time zone 'Asia/Kolkata')::date,
          p_kind, v_req.id);
  update public.donor_status
  set shows_total = shows_total + 1, updated_at = now()
  where user_id = v_resp.donor_id;
  update public.blood_requests set units_donated = units_donated + 1 where id = v_req.id;
end;
$$;

-- A member of the anchor organization records that screening deferred the donor (S22). It
-- counts as a show. The reason is the staff's own words, kept on the response; donors can't
-- read it.
create or replace function public.defer_donor(p_response_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_reason text := btrim(p_reason);
  v_resp public.request_responses;
  v_req public.blood_requests;
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) not between 1 and 200 then
    raise exception 'Give a reason of 1 to 200 characters' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('bloodlink.match_wave'));
  select * into v_resp from public.request_responses where id = p_response_id for update;
  if not found then
    raise exception 'No such response' using errcode = 'P0002';
  end if;
  select * into v_req from public.blood_requests where id = v_resp.request_id;
  if v_req.mode <> 'live' or not public.is_request_member(v_req.id) then
    raise exception 'Only a member of the raising organization can defer a donor'
      using errcode = '42501';
  end if;
  if v_resp.status not in ('accepted', 'arrived') then
    raise exception 'Only an accepted donor can be deferred' using errcode = '22023';
  end if;

  update public.request_responses
  set status = 'deferred', deferral_reason = v_reason
  where id = v_resp.id;
  update public.donor_status
  set shows_total = shows_total + 1, updated_at = now()
  where user_id = v_resp.donor_id;
end;
$$;

-- The donors who accepted a request, for a member of its organization (S25): name always, the
-- phone only when the donor ticked "share my number with the centre" and hasn't withdrawn it,
-- and the check-in code to match against what the donor shows. Each call writes one
-- contact_reveals row per donor returned.
create or replace function public.request_donor_contacts(p_request_id bigint)
returns table (
  response_id bigint,
  donor_name text,
  phone text,
  status text,
  hold_until timestamptz,
  check_in_code text,
  phone_shared boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not exists (select 1 from public.blood_requests where id = p_request_id) then
    raise exception 'No such request' using errcode = 'P0002';
  end if;
  if not public.is_request_member(p_request_id) then
    raise exception 'Only a member of the raising organization can see the donors'' contacts'
      using errcode = '42501';
  end if;
  return query
  with shown as (
    select r.id as response_id, r.donor_id, r.status, r.hold_until, r.check_in_code,
           (r.share_phone and exists (
              select 1 from public.consents c
              where c.user_id = r.donor_id and c.purpose = 'share_phone_with_centre'
                and c.withdrawn_at is null
            )) as phone_ok
    from public.request_responses r
    where r.request_id = p_request_id and r.status in ('accepted', 'arrived')
  ),
  logged as (
    insert into public.contact_reveals (request_id, response_id, donor_id, revealed_by, phone_shared)
    select p_request_id, s.response_id, s.donor_id, v_user, s.phone_ok from shown s
    returning 1
  )
  select s.response_id, p.full_name, case when s.phone_ok then p.phone end, s.status,
         s.hold_until, s.check_in_code, s.phone_ok
  from shown s
  join public.profiles p on p.id = s.donor_id
  order by s.response_id;
end;
$$;

-- ── pilot hours (S30) ────────────────────────────────────────────────────────

-- Whether a live wave may run at p_at (default now): 09:00 to 20:00 India time, or a critical
-- request of an organization whose critical_outside_hours flag an admin has turned on.
create or replace function public.live_wave_allowed_now(
  p_urgency text,
  p_organization_id uuid,
  p_at timestamptz default now()
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select ((p_at at time zone 'Asia/Kolkata')::time >= time '09:00'
          and (p_at at time zone 'Asia/Kolkata')::time < time '20:00')
      or (p_urgency = 'critical' and coalesce((
            select f.critical_outside_hours from public.organization_live_flags f
            where f.organization_id = p_organization_id), false));
$$;

-- The next 09:00 India time after p_from (default now): today's if it is still ahead.
create or replace function public.next_live_window_start(p_from timestamptz default now())
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (date_trunc('day', p_from at time zone 'Asia/Kolkata')
          + case when (p_from at time zone 'Asia/Kolkata')::time < time '09:00'
                 then interval '9 hours' else interval '1 day 9 hours' end)
         at time zone 'Asia/Kolkata';
$$;

-- ── advance_requests ─────────────────────────────────────────────────────────

-- Replaces the phase 2 function. Unchanged for shadow requests. For a live request it also:
-- turns an accepted place whose hold has run out into no_show, skips the next wave while a
-- report has the request paused. A card stays answerable through later waves: it is settled only
-- when the request is covered, fulfilled, cancelled, paused or past needed_by, through
-- blood_requests_live_status_change(). A live wave (the first and every later one) runs only
-- from 09:00 to 20:00 India time, except a critical request of an organization whose
-- critical_outside_hours flag is on; outside the window next_wave_at moves to the next 09:00.
create or replace function public.advance_requests()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_req public.blood_requests;
  v_set record;
  v_left integer;
  v_on_hold integer;
  v_end_state text;
  v_status text;
  v_reason text;
  v_asked integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('bloodlink.match_wave'));

  for v_id in
    select r.id from public.blood_requests r where r.status in ('open', 'covered') order by r.id
  loop
    select * into v_req from public.blood_requests where id = v_id for update;
    if v_req.mode = 'live' then
      update public.request_responses
      set status = 'no_show'
      where request_id = v_id and status = 'accepted' and hold_until is not null
        and hold_until <= now();
    end if;
    select * into v_set from public.donor_wave_settings(v_req.urgency);
    if v_req.mode = 'live' and v_req.next_wave_at <= now() and now() < v_req.needed_by
       and v_req.paused_at is null and v_req.waves_sent < v_set.max_waves
       and not public.live_wave_allowed_now(v_req.urgency, v_req.organization_id) then
      update public.blood_requests set next_wave_at = public.next_live_window_start()
      where id = v_id;
      select * into v_req from public.blood_requests where id = v_id;
    end if;
    if v_req.next_wave_at <= now() and now() < v_req.needed_by and v_req.paused_at is null then
      v_asked := v_asked + public.match_wave(v_id);
      select * into v_req from public.blood_requests where id = v_id;
    end if;

    v_left := v_req.units_needed - v_req.units_donated;
    v_on_hold := (select count(*) from public.request_responses r
                  where r.request_id = v_id and r.status in ('accepted', 'arrived'));
    v_end_state := case when v_req.units_donated > 0 then 'partly_fulfilled' else 'expired' end;

    if v_left <= 0 then
      v_status := 'fulfilled';
      v_reason := 'Units donated';
    elsif now() >= v_req.needed_by then
      v_status := v_end_state;
      v_reason := 'Needed-by time reached';
    elsif v_on_hold >= ceil(round(v_left * v_set.overbook, 9)) then
      v_status := 'covered';
    elsif v_req.waves_sent >= v_set.max_waves and now() >= v_req.next_wave_at then
      v_status := v_end_state;
      v_reason := 'All waves sent';
    else
      v_status := 'open';
    end if;

    if v_status <> v_req.status then
      update public.blood_requests
      set status = v_status,
          closed_at = case when v_status in ('open', 'covered') then null else now() end,
          close_reason = case when v_status in ('open', 'covered') then null else v_reason end
      where id = v_id;
    end if;
  end loop;

  return v_asked;
end;
$$;

-- ── grants ───────────────────────────────────────────────────────────────────

-- Donors have no select on request_responses, on any column (S20, S35).
revoke all on public.request_responses from public, anon, authenticated;

revoke all on public.organization_live_flags, public.donor_card_signals, public.contact_reveals,
  public.abuse_reports from public, anon, authenticated;
grant select on public.organization_live_flags to authenticated;
grant select on public.donor_card_signals to authenticated;
grant select on public.contact_reveals to authenticated;
grant select on public.abuse_reports to authenticated;
grant insert (request_id, kind, details, reporter_id) on public.abuse_reports to authenticated;

-- Internal: triggers and the cron job only.
revoke execute on function public.touch_card_signals(uuid[]),
  public.bump_ignored(uuid[]),
  public.request_responses_after_write(),
  public.blood_requests_live_status_change(),
  public.abuse_reports_after_insert(),
  public.abuse_reports_before_insert(),
  public.live_wave_allowed_now(text, uuid, timestamptz),
  public.next_live_window_start(timestamptz),
  public.advance_requests()
  from public, anon, authenticated;

-- Signed-in callers; each checks auth.uid() itself.
revoke execute on function public.was_asked_for_request(bigint),
  public.is_request_member(bigint),
  public.set_organization_live(uuid, boolean, boolean),
  public.set_user_suspended(uuid, boolean, text),
  public.review_abuse_report(bigint, text, text),
  public.admin_request_responses(bigint),
  public.my_request_cards(),
  public.mark_card_seen(bigint),
  public.respond(bigint, boolean),
  public.cancel_response(bigint),
  public.check_in(bigint, text),
  public.confirm_donation(bigint, text),
  public.defer_donor(bigint, text),
  public.request_donor_contacts(bigint),
  public.create_request(text, text, text, integer, text, timestamptz, boolean, text, text,
    numeric, numeric, numeric)
  from public, anon;
grant execute on function public.was_asked_for_request(bigint),
  public.is_request_member(bigint),
  public.set_organization_live(uuid, boolean, boolean),
  public.set_user_suspended(uuid, boolean, text),
  public.review_abuse_report(bigint, text, text),
  public.admin_request_responses(bigint),
  public.my_request_cards(),
  public.mark_card_seen(bigint),
  public.respond(bigint, boolean),
  public.cancel_response(bigint),
  public.check_in(bigint, text),
  public.confirm_donation(bigint, text),
  public.defer_donor(bigint, text),
  public.request_donor_contacts(bigint),
  public.create_request(text, text, text, integer, text, timestamptz, boolean, text, text,
    numeric, numeric, numeric)
  to authenticated;

-- ── realtime ─────────────────────────────────────────────────────────────────

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.donor_card_signals;
  end if;
end;
$$;

-- ── create_request ───────────────────────────────────────────────────────────

-- Replaces the phase 2 function. The request is live only when an admin has turned
-- organization_live_flags on for the raising organization; otherwise it is shadow (S19).
create or replace function public.create_request(
  p_anchor_hospital_code text,
  p_blood_group_code text,
  p_component_code text,
  p_units_needed integer,
  p_urgency text,
  p_needed_by timestamptz,
  p_allow_compatible boolean,
  p_patient_reference text,
  p_kind text,
  p_zone_free_flow_kmh numeric,
  p_congestion_percent numeric,
  p_rain_factor numeric
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org public.organizations;
  v_point extensions.geography;
  v_banks integer;
  v_area text;
  v_reference text := nullif(btrim(p_patient_reference), '');
  v_ist timestamp := now() at time zone 'Asia/Kolkata';
  v_first_wave timestamptz := now();
  v_mode text;
  v_wave_now boolean;
  v_id bigint;
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('bloodlink.match_wave'));

  -- S5: the approved applicant of an approved organization, not suspended.
  select o.* into v_org
  from public.profiles p
  join public.organizations o on o.id = p.organization_id
  where p.id = v_user and o.status = 'approved' and not p.is_suspended;
  if not found then
    raise exception 'Only a member of an approved organization can raise a request'
      using errcode = '42501';
  end if;
  if (select count(*) from public.blood_requests r
      where r.organization_id = v_org.id and r.status in ('open', 'covered')) >= 10 then
    raise exception 'Your organization already has 10 open requests' using errcode = '22023';
  end if;
  if (select count(*) from public.blood_requests r
      where r.organization_id = v_org.id
        and (r.created_at at time zone 'Asia/Kolkata')::date = v_ist::date) >= 20 then
    raise exception 'Your organization has raised 20 requests today' using errcode = '22023';
  end if;

  -- The same rules as sanitizeRequest() in src/lib/donorRequests.js.
  if p_kind is null or p_kind not in ('shortfall', 'apheresis') then
    raise exception 'Choose shortfall or apheresis' using errcode = '22023';
  end if;
  if p_urgency is null or p_urgency not in ('critical', 'urgent', 'routine') then
    raise exception 'Choose critical, urgent or routine' using errcode = '22023';
  end if;
  if p_units_needed is null or p_units_needed not between 1 and 50 then
    raise exception 'Units needed must be from 1 to 50' using errcode = '22023';
  end if;
  if p_blood_group_code is null
     or not exists (select 1 from public.blood_compatibility c where c.recipient_code = p_blood_group_code) then
    raise exception 'Unknown blood group' using errcode = '22023';
  end if;
  if public.component_category(p_component_code) is null then
    raise exception 'Unknown component' using errcode = '22023';
  end if;
  if p_needed_by is null or p_needed_by < now() + interval '30 minutes'
     or p_needed_by > now() + interval '14 days' then
    raise exception 'The blood must be needed between 30 minutes and 14 days from now'
      using errcode = '22023';
  end if;
  if coalesce(p_allow_compatible, false) and v_org.kind <> 'blood_bank' then
    raise exception 'Only a blood bank may accept compatible groups' using errcode = '42501';
  end if;
  if v_reference is not null
     and (char_length(v_reference) > 40 or v_reference ~ '[[:cntrl:]]') then
    raise exception 'The patient reference must be at most 40 characters' using errcode = '22023';
  end if;
  if p_zone_free_flow_kmh is null or p_zone_free_flow_kmh not between 5 and 120
     or p_congestion_percent is null or p_congestion_percent not between 0 and 200
     or p_rain_factor is null or p_rain_factor not between 1 and 1.3 then
    raise exception 'The travel conditions are out of range' using errcode = '22023';
  end if;

  -- S6: the anchor's position.
  if not exists (select 1 from public.blood_banks b where b.hospital_code = p_anchor_hospital_code) then
    raise exception 'No blood bank has that eRaktKosh code' using errcode = 'P0002';
  end if;
  select coalesce(
    (select f.location from public.bank_location_fixes f
     where f.hospital_code = p_anchor_hospital_code and f.status = 'accepted'),
    (select b.location from public.blood_banks b
     where b.hospital_code = p_anchor_hospital_code and b.location_quality = 'ok')
  ) into v_point;
  if v_point is null then
    raise exception 'bloodLink has no usable position for that blood bank' using errcode = '22023';
  end if;

  -- S7: banks with a usable position within 15 km, the anchor included.
  select count(*) into v_banks
  from (
    select b.hospital_code
    from public.blood_banks b
    where b.location_quality = 'ok'
      and extensions.st_dwithin(b.location, v_point, 15000)
      and not exists (select 1 from public.bank_location_fixes f
                      where f.hospital_code = b.hospital_code and f.status = 'accepted')
    union all
    select f.hospital_code
    from public.bank_location_fixes f
    where f.status = 'accepted' and extensions.st_dwithin(f.location, v_point, 15000)
  ) banks;
  v_area := case when v_banks > 10 then 'urban' else 'rural' end;

  -- S13: a routine request's first wave waits for the 09:00 to 20:00 India window.
  if p_urgency = 'routine' then
    if v_ist::time < time '09:00' then
      v_first_wave := (date_trunc('day', v_ist) + interval '9 hours') at time zone 'Asia/Kolkata';
    elsif v_ist::time >= time '20:00' then
      v_first_wave := (date_trunc('day', v_ist) + interval '1 day 9 hours') at time zone 'Asia/Kolkata';
    end if;
  end if;

  select case when coalesce((select f.is_live from public.organization_live_flags f
                             where f.organization_id = v_org.id), false)
              then 'live' else 'shadow' end into v_mode;

  -- S30: a live request raised outside 09:00 to 20:00 India time starts at the next 09:00,
  -- unless it is critical and an admin allows that organization's critical requests any hour.
  v_wave_now := true;
  if v_mode = 'live' and not public.live_wave_allowed_now(p_urgency, v_org.id) then
    v_first_wave := public.next_live_window_start();
    v_wave_now := false;
  end if;

  insert into public.blood_requests
    (kind, organization_id, anchor_hospital_code, anchor_point, blood_group_code, component_id,
     units_needed, urgency, needed_by, allow_compatible, patient_reference,
     zone_free_flow_kmh, congestion_percent, rain_factor, area, next_wave_at, created_by, mode)
  values
    (p_kind, v_org.id, p_anchor_hospital_code, v_point, p_blood_group_code, p_component_code,
     p_units_needed, p_urgency, p_needed_by, coalesce(p_allow_compatible, false), v_reference,
     p_zone_free_flow_kmh, p_congestion_percent, p_rain_factor, v_area, v_first_wave, v_user, v_mode)
  returning id into v_id;

  if p_urgency <> 'routine' and v_wave_now then
    perform public.match_wave(v_id);
  end if;
  return v_id;
end;
$$;
