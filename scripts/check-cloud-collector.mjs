// Checks the cloud collector's SQL (supabase/migrations/*_cloud_collector.sql) on
// the project in SUPABASE_DB_URL, inside one transaction that is always rolled
// back, so nothing is kept and nothing is sent: no tick runs, so pg_net is never
// called. Applies the migration first if the project doesn't have it yet.
//
// Usage: node scripts/check-cloud-collector.mjs
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  console.error("SUPABASE_DB_URL is not set (add it to .env.local).");
  process.exit(1);
}
const migrationFile = fs
  .readdirSync(path.join("supabase", "migrations"))
  .find((fileName) => fileName.endsWith("_cloud_collector.sql"));

const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
let failures = 0;
const check = (name, isOk, detail = "") => {
  console.log(`${isOk ? "ok  " : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!isOk) failures += 1;
};
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
// Runs sql in a savepoint and returns the SQLSTATE it raised, or null.
async function errorCode(sql, params) {
  await client.query("savepoint attempt");
  try {
    await client.query(sql, params);
    await client.query("release savepoint attempt");
    return null;
  } catch (error) {
    await client.query("rollback to savepoint attempt");
    return error.code;
  }
}
const due = async (batch, interval = "4 hours 30 minutes") =>
  (await one("select public.collector_due($1, $2::interval) as id", [batch, interval])).id;
const moveLastSweep = (ago) =>
  client.query(
    `update public.collector_sweeps set started_at = now() - $1::interval
     where id = (select max(id) from public.collector_sweeps)`,
    [ago],
  );

await client.connect();
try {
  await client.query("begin");
  const { applied } = await one(
    "select exists (select 1 from supabase_migrations.schema_migrations where version = $1) as applied",
    [migrationFile.split("_")[0]],
  );
  if (!applied) {
    await client.query(fs.readFileSync(path.join("supabase", "migrations", migrationFile), "utf8"));
  }
  console.log(
    `${migrationFile}: ${applied ? "already applied" : "applied inside the transaction"}`,
  );
  await client.query("delete from public.collector_sweeps");

  // ── collector_due: the 4.5-hour rhythm ──
  const first = await due(1);
  check("batch 1 starts a sweep when none exists", first !== null);
  check("batch 1 doesn't start a second one at once", (await due(1)) === null);
  check(
    "batches 2 to 4 follow their sweep",
    [await due(2), await due(3), await due(4)].every((id) => id === first),
  );
  check("each batch goes once per sweep", (await due(2)) === null);
  await moveLastSweep("4 hours 24 minutes");
  check("no sweep 4 h 24 min after the last", (await due(1)) === null);
  await moveLastSweep("4 hours 26 minutes");
  const second = await due(1);
  check("a sweep at the tick 4.5 hours on", second !== null && second !== first);
  await moveLastSweep("11 minutes");
  check("batch 2 skips a sweep that began over 10 minutes ago", (await due(2)) === null);
  await moveLastSweep("10 hours");
  check("a missed sweep restarts at the next tick", (await due(1)) !== null);
  check("batch 2 follows the restarted sweep", (await due(2)) !== null);
  check(
    "an interval under 1 hour is refused",
    (await errorCode("select public.collector_due(1, '30 minutes')")) === "22023",
  );
  check(
    "batch 5 is refused",
    (await errorCode("select public.collector_due(5, '6 hours')")) === "22023",
  );

  // ── scheduling ──
  check(
    "scheduling refuses an interval under 1 hour",
    (await errorCode("select public.schedule_stock_collector('59 minutes')")) === "22023",
  );
  check(
    "scheduling needs the Vault secrets",
    (await errorCode("select public.schedule_stock_collector()")) === "P0002",
  );
  await client.query(
    "select vault.create_secret('https://example.invalid/functions/v1/collect-stock', 'collector_url')",
  );
  await client.query("select vault.create_secret(repeat('x', 40), 'collector_secret')");
  await client.query("select public.schedule_stock_collector()");
  const { rows: jobs } = await client.query(
    "select jobname, schedule, command from cron.job where jobname like 'collector-%' order by jobname",
  );
  check(
    "five jobs at the planned minutes (UTC)",
    jobs.map((job) => job.schedule).join(" | ") ===
      "5,35 * * * * | 7,37 * * * * | 9,39 * * * * | 11,41 * * * * | 50 21 * * 0",
    jobs.map((job) => `${job.jobname} ${job.schedule}`).join("; "),
  );
  check(
    "the ticks carry the interval and region",
    jobs[0].command === "select public.collector_tick(1, '04:30:00'::interval, 'ap-south-1')",
    jobs[0].command,
  );
  await client.query("select public.schedule_stock_collector('6 hours', null)");
  const tick = await one("select command from cron.job where jobname = 'collector-batch-2'");
  check(
    "rescheduling replaces the jobs",
    tick.command === "select public.collector_tick(2, '06:00:00'::interval, NULL)",
    tick.command,
  );
  check(
    "unscheduling removes all five",
    (await one("select public.unschedule_stock_collector() as n")).n === 5,
  );

  // ── prune: only archived days go ──
  await client.query("set local role bloodlink_ingest");
  await client.query(
    `insert into public.stock_history (hospital_code, entry_at, fetched_at, state_code, stock) values
       ('9900001', now() - interval '71 days', date_trunc('day', now() - interval '70 days', 'UTC') + interval '6 hours', '30', '{}'),
       ('9900002', now() - interval '71 days', date_trunc('day', now() - interval '70 days', 'UTC') + interval '7 hours', '30', '{}'),
       ('9900003', now() - interval '72 days', date_trunc('day', now() - interval '69 days', 'UTC') + interval '6 hours', '30', '{}')`,
  );
  await client.query(
    `insert into public.collector_runs (job, runner, archive_path, archive_day, rows_archived)
     values ('upload', 'laptop', 'history/test.ndjson.gz',
       ((now() - interval '70 days') at time zone 'UTC')::date, 2)`,
  );
  const pruned = (await one("select public.prune_stock_store() as result")).result;
  const left = (
    await one(
      "select count(*)::int as n from public.stock_history where hospital_code like '99000%'",
    )
  ).n;
  check(
    "the archived day is deleted",
    pruned.history_deleted >= 2 && left === 1,
    JSON.stringify(pruned),
  );
  check(
    "the day the archive lacks is kept and listed",
    pruned.history_days_kept.some((day) => day.rows === 1 && day.archived === 0),
  );
  check(
    "the collector may record runs",
    (await errorCode(
      "insert into public.collector_runs (job, runner) values ('stock', 'edge')",
    )) === null,
  );
  check(
    "but may not touch the sweeps",
    (await errorCode("insert into public.collector_sweeps (sweep_interval) values ('6 hours')")) ===
      "42501",
  );
  check(
    "nor run the scheduler's functions",
    (await errorCode("select public.collector_due(1, '6 hours')")) === "42501",
  );
  await client.query("reset role");

  // ── the public can't see or start anything ──
  await client.query("set local role anon");
  check(
    "anon can't read collector_runs",
    (await errorCode("select * from public.collector_runs")) === "42501",
  );
  check(
    "anon can't schedule",
    (await errorCode("select public.schedule_stock_collector()")) === "42501",
  );
  check(
    "anon can't tick",
    (await errorCode("select public.collector_tick(1, '6 hours', null)")) === "42501",
  );
  await client.query("reset role");
  await client.query("set local role authenticated");
  await client.query(
    "select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-000000000000\"}', true)",
  );
  check(
    "a non-admin sees no runs",
    (await client.query("select * from public.collector_runs")).rows.length === 0,
  );
  await client.query("reset role");
  const bucket = await one("select public from storage.buckets where id = 'stock-archive'");
  check("the archive bucket is private", bucket?.public === false);
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
console.log(
  failures === 0
    ? "All checks passed; everything was rolled back."
    : `${failures} check(s) failed; everything was rolled back.`,
);
process.exit(failures === 0 ? 0 : 1);
