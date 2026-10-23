-- bloodLink stock store
-- A saved copy of eRaktKosh data that survives restarts, for the search
-- fallback and for building a stock history (forecasting, report 3).
--
-- * blood_banks        directory from a nationwide "nearest" call
-- * bank_stock_latest  one validated eRaktKosh row per bank
-- * stock_history      a compact copy whenever a bank's update time changes
-- * upstream_calls     every eRaktKosh call the collector made
--
-- Security model:
-- * The stock data is public, so anyone may read the first three tables.
--   The call log is for admins only.
-- * Only the no-login role bloodlink_ingest may write. scripts/snapshot.mjs
--   connects with SUPABASE_DB_URL and runs "set role bloodlink_ingest" first,
--   so the session can touch nothing else. Before deployment, give the role
--   a login and its own connection string instead.

-- ── role ─────────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'bloodlink_ingest') then
    create role bloodlink_ingest nologin;
  end if;
end
$$;
grant bloodlink_ingest to postgres;
grant usage on schema public to bloodlink_ingest;

-- ── tables ───────────────────────────────────────────────────────────────────

create table public.blood_banks (
  hospital_code text primary key check (hospital_code ~ '^[0-9]{1,10}$'),
  name text not null check (char_length(name) between 1 and 300),
  address text,
  phone text,
  email text,
  state_code text check (state_code ~ '^[0-9]{1,3}$'),
  district_id text check (district_id ~ '^[0-9]{1,5}$'),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  -- ok, outside_india (a data error), shared (same point as another bank) or missing
  location_quality text not null default 'ok'
    check (location_quality in ('ok', 'outside_india', 'shared', 'missing')),
  bank_type text,        -- "Blood Bank" or "BSU" (blood storage unit)
  hospital_type text,    -- "Govt.", "Private", "Charitable/Vol", "Red Cross"
  stock_source smallint, -- eRaktKosh's own field; meaning unpublished
  camp_source smallint,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table public.bank_stock_latest (
  hospital_code text primary key check (hospital_code ~ '^[0-9]{1,10}$'),
  state_code text not null check (state_code ~ '^[0-9]{1,3}$'),
  district_id text check (district_id ~ '^[0-9]{1,5}$'), -- from blood_banks, when known
  row jsonb not null,                -- the validated eRaktKosh row, same shape as live
  entry_at timestamptz,              -- when the bank last updated its stock
  fetched_at timestamptz not null    -- when bloodLink fetched it
);
create index bank_stock_latest_state_district on public.bank_stock_latest (state_code, district_id);

create table public.stock_history (
  hospital_code text not null check (hospital_code ~ '^[0-9]{1,10}$'),
  entry_at timestamptz not null,
  fetched_at timestamptz not null,
  state_code text not null check (state_code ~ '^[0-9]{1,3}$'),
  -- {"PRBC": {"O+Ve": 74, "B+Ve": 101}, "FFP": {...}}: component short name -> group -> units
  stock jsonb not null,
  primary key (hospital_code, entry_at)
);
create index stock_history_fetched_at on public.stock_history (fetched_at);

create table public.upstream_calls (
  id bigint generated always as identity primary key,
  called_at timestamptz not null default now(),
  endpoint text not null check (endpoint in ('blood-availability', 'bloodbank/nearest')),
  state_code text check (state_code ~ '^[0-9]{1,3}$'),
  ok boolean not null,
  http_status integer,
  duration_ms integer not null check (duration_ms >= 0),
  bytes integer check (bytes >= 0),
  rows integer check (rows >= 0),
  failure_kind text check (failure_kind in ('timeout', 'network', 'http', 'shape')),
  quality jsonb,                     -- validation counts from src/lib/stockQuality.js
  caller text not null default 'collector' check (caller in ('collector', 'app'))
);
create index upstream_calls_called_at on public.upstream_calls (called_at desc);

-- ── views and functions ──────────────────────────────────────────────────────

-- eRaktKosh health over the last 24 hours, per endpoint and state. Runs with the
-- caller's rights, so only admins see rows (through upstream_calls' policy).
create view public.upstream_stats with (security_invoker = true) as
select
  endpoint,
  state_code,
  count(*)::integer as calls,
  count(*) filter (where ok)::integer as ok_calls,
  round(100.0 * count(*) filter (where ok) / count(*), 1) as success_pct,
  round(percentile_cont(0.5) within group (order by duration_ms)::numeric) as median_ms,
  round(percentile_cont(0.95) within group (order by duration_ms)::numeric) as p95_ms,
  max(called_at) filter (where ok) as last_ok_at,
  max(called_at) as last_called_at
from public.upstream_calls
where called_at > now() - interval '24 hours'
group by endpoint, state_code;

-- Keeps the database small: history beyond p_history_days and call logs beyond
-- p_call_days are deleted. The collector keeps a full local archive.
create or replace function public.prune_stock_store(
  p_history_days integer default 60,
  p_call_days integer default 90
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_history integer;
  v_calls integer;
begin
  if p_history_days < 1 or p_call_days < 1 then
    raise exception 'retention must be at least one day' using errcode = '22023';
  end if;
  delete from public.stock_history where fetched_at < now() - make_interval(days => p_history_days);
  get diagnostics v_history = row_count;
  delete from public.upstream_calls where called_at < now() - make_interval(days => p_call_days);
  get diagnostics v_calls = row_count;
  return jsonb_build_object('history_deleted', v_history, 'calls_deleted', v_calls);
end;
$$;

-- ── row-level security ───────────────────────────────────────────────────────

alter table public.blood_banks enable row level security;
alter table public.bank_stock_latest enable row level security;
alter table public.stock_history enable row level security;
alter table public.upstream_calls enable row level security;

create policy blood_banks_read on public.blood_banks
  for select to anon, authenticated using (true);
create policy bank_stock_latest_read on public.bank_stock_latest
  for select to anon, authenticated using (true);
create policy stock_history_read on public.stock_history
  for select to anon, authenticated using (true);
create policy upstream_calls_select_admin on public.upstream_calls
  for select to authenticated using (public.is_admin());

create policy blood_banks_ingest on public.blood_banks
  for all to bloodlink_ingest using (true) with check (true);
create policy bank_stock_latest_ingest on public.bank_stock_latest
  for all to bloodlink_ingest using (true) with check (true);
create policy stock_history_ingest on public.stock_history
  for all to bloodlink_ingest using (true) with check (true);
create policy upstream_calls_ingest on public.upstream_calls
  for all to bloodlink_ingest using (true) with check (true);

-- ── grants ───────────────────────────────────────────────────────────────────

revoke all on public.blood_banks, public.bank_stock_latest, public.stock_history,
  public.upstream_calls, public.upstream_stats from public, anon, authenticated;

grant select on public.blood_banks, public.bank_stock_latest, public.stock_history
  to anon, authenticated;
grant select on public.upstream_calls, public.upstream_stats to authenticated;

grant select, insert, update on public.blood_banks, public.bank_stock_latest to bloodlink_ingest;
grant select, insert, delete on public.stock_history to bloodlink_ingest;
grant insert, delete on public.upstream_calls to bloodlink_ingest;

revoke execute on function public.prune_stock_store(integer, integer) from public, anon, authenticated;
grant execute on function public.prune_stock_store(integer, integer) to bloodlink_ingest;
