// Checks the stock-out forecast's schema (supabase/migrations/*_stockout_forecast.sql,
// docs/PLANS/ML_system.md phase 0) on the project in SUPABASE_DB_URL, inside one
// transaction that is always rolled back, so nothing is kept. Applies the migration
// first if the project doesn't have it yet. It writes nothing to the auth schema: the
// admin checks borrow an existing admin's id, and are skipped when there is none.
//
// Usage: node scripts/check-forecast-schema.mjs
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
  .find((fileName) => fileName.endsWith("_stockout_forecast.sql"));
// A local Postgres, for testing the script itself, needs no TLS.
const isLocal = ["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname);

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});
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
const asUser = async (userId) => {
  await client.query("reset role");
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
};

// 12:00 India time a day ago, on the grid, and 12:10, off it.
const GRID = "date_trunc('day', now() at time zone 'Asia/Kolkata') - interval '12 hours'";
const forecastRow = (asOf, p = "'{0.1,0.2,0.3}'") =>
  `insert into public.stock_forecasts
     (hospital_code, component_id, blood_group_code, as_of, model_version, p_raw, p, reasons)
   values ('9900001', '12', '16', (${asOf}) at time zone 'Asia/Kolkata', 'stockout-check-1',
     '{0.1,0.2,0.3}', ${p}, '[]')`;

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

  // ── flags and models, as the owner ──
  const flags = (
    await client.query("select name, is_enabled from public.feature_flags order by name")
  ).rows;
  check(
    "four flags, all off",
    flags.map((flag) => `${flag.name}:${flag.is_enabled}`).join(" ") ===
      "admin_events:false forecast_appeals:false forecast_badge:false forecast_ranking:false",
  );
  const model = (id, status) =>
    `insert into public.model_versions
       (id, kind, artifact_path, artifact_sha256, trained_from, trained_to, evaluation, status)
     values ('${id}', 'logistic', '${id}.json', repeat('a', 64), '2026-10-23', '2026-11-03', '{}', '${status}')`;
  await client.query(model("stockout-check-1", "live"));
  check(
    "a second live model is refused",
    (await errorCode(model("stockout-check-2", "live"))) === "23505",
  );
  check(
    "a bad artifact hash is refused",
    (await errorCode(model("stockout-check-3", "shadow").replace("repeat('a', 64)", "'abc'"))) ===
      "23514",
  );

  // ── the scoring role ──
  await client.query("set local role bloodlink_ml");
  check(
    "bloodlink_ml writes a forecast at a grid time",
    (await errorCode(forecastRow(GRID))) === null,
  );
  check(
    "but not off the grid",
    (await errorCode(forecastRow(`${GRID} + interval '10 minutes'`))) === "23514",
  );
  check(
    "nor a probability outside 0 to 1, or not three of them",
    (await errorCode(forecastRow(`${GRID} - interval '6 hours'`, "'{0.1,0.2,1.3}'"))) === "23514" &&
      (await errorCode(forecastRow(`${GRID} - interval '6 hours'`, "'{0.1,0.2}'"))) === "23514",
  );
  check(
    "bloodlink_ml records outcomes, runs and metrics",
    (await errorCode(
      `insert into public.forecast_outcomes (hospital_code, component_id, blood_group_code, as_of, stockout)
       values ('9900001', '12', '16', (${GRID}) at time zone 'Asia/Kolkata', '{false,null,true}')`,
    )) === null &&
      (await errorCode(
        "insert into public.forecast_runs (job, as_of, model_version) values ('score', now(), 'stockout-check-1')",
      )) === null &&
      (await errorCode(
        `insert into public.forecast_daily_metrics (day, horizon_h, model_version, cases, positives, cut_off)
         values (current_date - 1, 48, 'stockout-check-1', 10, 1, 0.2)`,
      )) === null,
  );
  check(
    "bloodlink_ml reads the stock store and the collector's runs",
    (await errorCode(
      `select (select count(*) from public.stock_history where false),
              (select count(*) from public.bank_stock_latest where false),
              (select count(*) from public.blood_banks where false),
              (select max(started_at) from public.collector_runs)`,
    )) === null,
  );
  check(
    "but can't write them, register models or set flags directly",
    (await errorCode(
      "insert into public.stock_history (hospital_code, entry_at, fetched_at, state_code, stock) values ('9900001', now(), now(), '30', '{}')",
    )) === "42501" &&
      (await errorCode(model("stockout-check-4", "shadow"))) === "42501" &&
      (await errorCode("update public.feature_flags set is_enabled = true")) === "42501",
  );
  check("bloodlink_ml may prune", (await errorCode("select public.prune_forecasts(60)")) === null);
  await client.query("reset role");

  // ── the kill switch ──
  await client.query(
    "update public.feature_flags set is_enabled = true where name in ('forecast_badge', 'admin_events')",
  );
  await client.query("set local role bloodlink_ml");
  const stopped = await one("select public.stop_forecast_flags('check: false alerts') as n");
  await client.query("reset role");
  const after = Object.fromEntries(
    (
      await client.query("select name, is_enabled, disabled_reason from public.feature_flags")
    ).rows.map((row) => [row.name, row]),
  );
  check(
    "the kill switch turns the forecast's flags off, with the reason",
    stopped.n === 1 &&
      after.forecast_badge.is_enabled === false &&
      after.forecast_badge.disabled_reason === "check: false alerts",
  );
  check("and leaves admin_events alone", after.admin_events.is_enabled === true);
  check(
    "and writes the audit log",
    (
      await one(
        "select count(*)::int as n from public.audit_log where action = 'feature_flag.kill_switch' and actor_id is null",
      )
    ).n >= 1,
  );

  // ── the public and signed-in non-admins ──
  await client.query("set local role anon");
  check(
    "anon can't read forecasts or flags",
    (await errorCode("select * from public.stock_forecasts")) === "42501" &&
      (await errorCode("select * from public.feature_flags")) === "42501",
  );
  check(
    "anon can't set flags or stop them",
    (await errorCode("select public.set_feature_flag('forecast_badge', true)")) === "42501" &&
      (await errorCode("select public.stop_forecast_flags('x')")) === "42501",
  );
  await asUser("00000000-0000-0000-0000-000000000000");
  check(
    "a non-admin sees no forecasts, outcomes, runs or flags",
    (await client.query("select * from public.stock_forecasts")).rows.length === 0 &&
      (await client.query("select * from public.forecast_outcomes")).rows.length === 0 &&
      (await client.query("select * from public.forecast_runs")).rows.length === 0 &&
      (await client.query("select * from public.feature_flags")).rows.length === 0,
  );
  check(
    "a non-admin can't set a flag, stop the flags or prune",
    (await errorCode("select public.set_feature_flag('forecast_badge', true)")) === "42501" &&
      (await errorCode("select public.stop_forecast_flags('x')")) === "42501" &&
      (await errorCode("select public.prune_forecasts(60)")) === "42501",
  );
  await client.query("reset role");

  // ── an admin ──
  const admin = await one("select id from public.profiles where role = 'admin' limit 1");
  if (!admin) {
    console.log("skip  the admin checks: no admin in this project");
  } else {
    await asUser(admin.id);
    check(
      "an admin reads forecasts and flags",
      (await client.query("select * from public.stock_forecasts where hospital_code = '9900001'"))
        .rows.length === 1 &&
        (await client.query("select * from public.feature_flags")).rows.length === 4,
    );
    check(
      "an admin turns a flag on, which clears the kill switch's reason",
      (await errorCode("select public.set_feature_flag('forecast_badge', true)")) === null &&
        (
          await one(
            "select disabled_reason from public.feature_flags where name = 'forecast_badge'",
          )
        ).disabled_reason === null,
    );
    check(
      "an unknown flag is refused",
      (await errorCode("select public.set_feature_flag('nothing', true)")) === "P0002",
    );
    check(
      "but not by writing the table",
      (await errorCode("update public.feature_flags set is_enabled = false")) === "42501",
    );
    await client.query("reset role");
    check(
      "the change is audited with the admin as actor",
      (
        await one(
          "select count(*)::int as n from public.audit_log where action = 'feature_flag.changed' and actor_id = $1",
          [admin.id],
        )
      ).n >= 1,
    );
  }

  // ── the collector's new call and column ──
  await client.query("set local role bloodlink_ingest");
  check(
    "the collector logs the auto-refresh call",
    (await errorCode(
      "insert into public.upstream_calls (endpoint, ok, duration_ms) values ('master/portal-refresh-hospitals', true, 10)",
    )) === null,
  );
  check(
    "and sets auto_refresh",
    (await errorCode(
      "update public.blood_banks set auto_refresh = (hospital_code = any($1::text[])) where false",
      [["1"]],
    )) === null,
  );
  await client.query("reset role");
  const bucket = await one("select public from storage.buckets where id = 'ml-models'");
  check("the model bucket is private", bucket?.public === false);
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
