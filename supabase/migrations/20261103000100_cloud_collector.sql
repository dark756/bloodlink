-- bloodLink: the cloud collector (docs/PLANS/supabase_scheduler.md, #35)
-- pg_cron ticks every 30 minutes and pg_net calls the collect-stock Edge Function,
-- which runs src/lib/collector.js as bloodlink_ingest, exactly as the laptop does.
--
-- * collector_sweeps   one row per sweep, started by collector_tick(1)
-- * collector_runs     one row per collector job, from the cloud or the laptop
-- * stock-archive      private Storage bucket: every change, gzipped, for good
-- * prune_stock_store  now deletes a day of history only once the archive holds it
--
-- This migration schedules nothing. scripts/setup-cloud-collector.mjs stores the
-- function's URL and secret in Vault; then
--   select public.schedule_stock_collector();     starts it (every 4.5 hours)
--   select public.unschedule_stock_collector();   stops it

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
grant usage on schema cron to postgres;

-- ── tables ───────────────────────────────────────────────────────────────────

create table public.collector_sweeps (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  sweep_interval interval not null check (sweep_interval >= interval '1 hour'),
  posted_batches integer[] not null default '{}' -- batches collector_tick has sent
);
create index collector_sweeps_started_at on public.collector_sweeps (started_at desc);

create table public.collector_runs (
  id bigint generated always as identity primary key,
  -- stock: states (a cloud batch, or the laptop's --all or --states); upload: laptop
  -- history put into the archive by scripts/upload-archive.mjs
  job text not null check (job in ('stock', 'directory', 'prune', 'upload')),
  batch smallint check (batch between 1 and 4),
  sweep_id bigint references public.collector_sweeps (id) on delete set null,
  runner text not null check (runner in ('edge', 'laptop')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  states_saved smallint check (states_saved >= 0),
  states_failed smallint check (states_failed >= 0),
  states_skipped smallint check (states_skipped >= 0),
  rows_changed integer check (rows_changed >= 0), -- history rows written
  -- The stock-archive file this run wrote, the UTC day its lines belong to, and how
  -- many lines it holds. Only Storage files count; the laptop's local archive doesn't.
  archive_path text,
  archive_day date,
  rows_archived integer check (rows_archived >= 0),
  result jsonb,                                    -- the directory's flags or the prune's report
  error text check (char_length(error) <= 1000),
  check (job = 'stock' or batch is null)
);
create index collector_runs_started_at on public.collector_runs (started_at desc);
create index collector_runs_archive_day on public.collector_runs (archive_day)
  where archive_day is not null;
-- Re-uploading a day replaces its row, so the prune never counts it twice.
create unique index collector_runs_upload_path on public.collector_runs (archive_path)
  where job = 'upload';

-- ── archive bucket ───────────────────────────────────────────────────────────

-- Private, with no policies: only the built-in secret key reaches it (the Edge
-- Function, and the laptop's upload and sync scripts). Layout, UTC dates:
--   history/YYYY-MM-DD/HHMM-bN.ndjson.gz   one cloud batch's changed rows
--   history/YYYY-MM-DD.ndjson.gz           one day of the laptop's history
--   sweeps/YYYY-MM-DD/HHMM-bN.json         one cloud batch's summary
--   sweeps.ndjson.gz                       the laptop's sweep summaries
--   directory/YYYY-MM-DD.json.gz           the weekly directory answer
insert into storage.buckets (id, name, public, allowed_mime_types)
values ('stock-archive', 'stock-archive', false, array['application/gzip', 'application/json'])
on conflict (id) do nothing;

-- ── prune ────────────────────────────────────────────────────────────────────

-- History beyond p_history_days is deleted only for UTC days whose rows the
-- Storage archive holds: the lines recorded in collector_runs for that day must
-- cover every row of it. Days that fall short are kept and listed in
-- history_days_kept, so a failed upload costs space, never data. Call logs beyond
-- p_call_days are deleted as before.
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
  v_cutoff timestamptz;
  v_last_day date;
  v_kept jsonb;
  v_kept_days date[];
  v_history integer;
  v_calls integer;
begin
  if p_history_days < 1 or p_call_days < 1 then
    raise exception 'retention must be at least one day' using errcode = '22023';
  end if;
  v_cutoff := now() - make_interval(days => p_history_days);
  v_last_day := (v_cutoff at time zone 'UTC')::date;

  select
    coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'rows', d.rows,
      'archived', coalesce(a.rows, 0)) order by d.day), '[]'::jsonb),
    coalesce(array_agg(d.day), '{}')
  into v_kept, v_kept_days
  from (
    select (h.fetched_at at time zone 'UTC')::date as day, count(*) as rows
    from public.stock_history h
    where h.fetched_at < (v_last_day + 1)::timestamp at time zone 'UTC'
    group by 1
  ) d
  left join (
    select r.archive_day as day, sum(r.rows_archived) as rows
    from public.collector_runs r
    where r.archive_day <= v_last_day and r.rows_archived is not null
    group by 1
  ) a using (day)
  where coalesce(a.rows, 0) < d.rows;

  delete from public.stock_history
  where fetched_at < v_cutoff
    and (fetched_at at time zone 'UTC')::date <> all (v_kept_days);
  get diagnostics v_history = row_count;
  delete from public.upstream_calls where called_at < now() - make_interval(days => p_call_days);
  get diagnostics v_calls = row_count;
  return jsonb_build_object('history_deleted', v_history, 'calls_deleted', v_calls,
    'history_days_kept', v_kept);
end;
$$;

-- ── scheduling ───────────────────────────────────────────────────────────────

-- Whether batch p_batch is due, recording it if so. Returns the sweep's id, or
-- null when nothing is due.
-- * Batch 1 starts a sweep when the last one began p_interval ago, less 5 minutes
--   for cron jitter, so sweeps land on the half-hour tick p_interval apart. After a
--   missed sweep (a paused project), the next tick starts one at once.
-- * Batches 2 to 4 follow only a sweep that began in the last 10 minutes, once each.
create or replace function public.collector_due(p_batch integer, p_interval interval)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sweep public.collector_sweeps;
begin
  if p_batch is null or p_batch not between 1 and 4 then
    raise exception 'batch must be 1 to 4' using errcode = '22023';
  end if;
  if p_interval is null or p_interval < interval '1 hour' then
    raise exception 'the interval must be at least 1 hour' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('collector_due'));
  select * into v_sweep from public.collector_sweeps order by started_at desc limit 1;

  if p_batch = 1 then
    if v_sweep.id is not null
      and v_sweep.started_at > now() - (p_interval - interval '5 minutes') then
      return null;
    end if;
    insert into public.collector_sweeps (sweep_interval, posted_batches)
    values (p_interval, '{1}')
    returning * into v_sweep;
    return v_sweep.id;
  end if;

  if v_sweep.id is null
    or v_sweep.started_at <= now() - interval '10 minutes'
    or p_batch = any (v_sweep.posted_batches) then
    return null;
  end if;
  update public.collector_sweeps set posted_batches = posted_batches || p_batch
  where id = v_sweep.id;
  return v_sweep.id;
end;
$$;

-- Posts p_body to the collect-stock function, with its URL and secret from Vault,
-- pinned to p_region when given. Returns pg_net's request id.
create or replace function public.collector_post(p_body jsonb, p_region text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_headers jsonb;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'collector_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'collector_secret';
  if v_url is null or v_secret is null then
    raise exception 'collector_url and collector_secret must be in Vault' using errcode = 'P0002';
  end if;
  v_headers := jsonb_build_object('Content-Type', 'application/json', 'x-collector-secret', v_secret);
  if p_region is not null then
    v_headers := v_headers || jsonb_build_object('x-region', p_region);
  end if;
  return net.http_post(url := v_url, body := p_body, headers := v_headers,
    timeout_milliseconds := 150000);
end;
$$;

-- What each 30-minute cron job runs: a small check, and a call only when due.
create or replace function public.collector_tick(p_batch integer, p_interval interval, p_region text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sweep bigint;
begin
  v_sweep := public.collector_due(p_batch, p_interval);
  if v_sweep is null then
    return null;
  end if;
  return public.collector_post(jsonb_build_object('batch', p_batch, 'sweep', v_sweep), p_region);
end;
$$;

-- The weekly job: trims pg_cron's own run log (the ticks add about 190 rows a
-- day), then asks for the directory and the prune.
create or replace function public.collector_weekly(p_region text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from cron.job_run_details where end_time < now() - interval '7 days';
  return public.collector_post('{"directory": true, "prune": true}'::jsonb, p_region);
end;
$$;

-- Creates or replaces the five cron jobs (UTC times). The batch ticks run at :05,
-- :07, :09 and :11 and again at :35 to :41 India time; the weekly job at Monday
-- 03:20 India time, between batch slots, so eRaktKosh sees one request at a time.
-- p_region null leaves the function in its default region.
create or replace function public.schedule_stock_collector(
  p_interval interval default '4 hours 30 minutes',
  p_region text default 'ap-south-1'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_minutes text[] := array['5,35', '7,37', '9,39', '11,41'];
  v_jobs jsonb := '{}';
  v_batch integer;
begin
  if p_interval is null or p_interval < interval '1 hour' then
    raise exception 'the interval must be at least 1 hour' using errcode = '22023';
  end if;
  if p_region is not null and p_region !~ '^[a-z]{2}-[a-z]+-[0-9]$' then
    raise exception 'region must look like ap-south-1' using errcode = '22023';
  end if;
  if (select count(*) from vault.decrypted_secrets
      where name in ('collector_url', 'collector_secret')) < 2 then
    raise exception 'store collector_url and collector_secret in Vault first (scripts/setup-cloud-collector.mjs)'
      using errcode = 'P0002';
  end if;
  for v_batch in 1..4 loop
    v_jobs := v_jobs || jsonb_build_object(format('collector-batch-%s', v_batch),
      cron.schedule(format('collector-batch-%s', v_batch), v_minutes[v_batch] || ' * * * *',
        format('select public.collector_tick(%s, %L::interval, %L)', v_batch, p_interval, p_region)));
  end loop;
  v_jobs := v_jobs || jsonb_build_object('collector-weekly',
    cron.schedule('collector-weekly', '50 21 * * 0',
      format('select public.collector_weekly(%L)', p_region)));
  return v_jobs;
end;
$$;

-- Removes the five cron jobs. Returns how many there were.
create or replace function public.unschedule_stock_collector()
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
    select jobname from cron.job
    where jobname in ('collector-batch-1', 'collector-batch-2', 'collector-batch-3',
      'collector-batch-4', 'collector-weekly')
  loop
    perform cron.unschedule(v_name);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ── row-level security ───────────────────────────────────────────────────────

alter table public.collector_sweeps enable row level security;
alter table public.collector_runs enable row level security;

create policy collector_sweeps_select_admin on public.collector_sweeps
  for select to authenticated using (public.is_admin());
create policy collector_runs_select_admin on public.collector_runs
  for select to authenticated using (public.is_admin());
create policy collector_runs_ingest on public.collector_runs
  for all to bloodlink_ingest using (true) with check (true);

-- ── grants ───────────────────────────────────────────────────────────────────

revoke all on public.collector_sweeps, public.collector_runs from public, anon, authenticated;
grant select on public.collector_sweeps, public.collector_runs to authenticated;
-- The collector records its runs; the prune, which runs as this role, reads them.
grant select, insert, update on public.collector_runs to bloodlink_ingest;

-- Only the cron jobs' owner (postgres) may run these.
revoke execute on function public.collector_due(integer, interval),
  public.collector_post(jsonb, text),
  public.collector_tick(integer, interval, text),
  public.collector_weekly(text),
  public.schedule_stock_collector(interval, text),
  public.unschedule_stock_collector()
  from public, anon, authenticated, service_role;
