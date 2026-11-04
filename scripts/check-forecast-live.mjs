// A dry run of the live stock-out forecast (docs/PLANS/ML_system.md, Part A) on the
// project in SUPABASE_DB_URL, inside one transaction that is always rolled back, so
// nothing is kept. It applies the forecast's migrations first if the project lacks
// them, registers the artifact as the live model, and runs the real jobs of
// src/lib/forecastJobs.js as bloodlink_ml on the project's own stock history:
// - scoring the latest grid time;
// - scoring the four grid times of an India day 4 days back, then the daily job, which
//   labels them, calibrates that day, records its metrics and runs the kill switch;
// then checks what forecast_marks() shows anon with the flags off and on, and that
// anon can't post or schedule jobs. The jobs' own begin and commit become savepoints,
// so nothing they do outlives the transaction.
//
// Usage: node scripts/check-forecast-live.mjs [ml/models/<id>.json]
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { createForecastJobs, GROUP_CODES } from "../src/lib/forecastJobs.js";
import { latestGridTime } from "../src/lib/stockoutFeatures.js";
import { thresholdOf, validateArtifact } from "../src/lib/stockoutModel.js";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  console.error("SUPABASE_DB_URL is not set (add it to .env.local).");
  process.exit(1);
}
const artifactFile =
  process.argv[2] ??
  path.join(
    "ml",
    "models",
    fs
      .readdirSync(path.join("ml", "models"))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .at(-1),
  );
const bytes = fs.readFileSync(artifactFile);
const digest = crypto.createHash("sha256").update(bytes).digest("hex");
const { artifact, error: artifactError } = validateArtifact(JSON.parse(bytes.toString("utf8")));
if (artifactError) {
  console.error(`${artifactFile}: ${artifactError}`);
  process.exit(1);
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
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
async function errorCode(sql, params) {
  await client.query("savepoint attempt");
  try {
    await client.query(sql, params);
    await client.query("release savepoint attempt");
    return null;
  } catch (error) {
    await client.query("rollback to savepoint attempt");
    return error.code ?? "error";
  }
}
// The jobs' transactions as savepoints inside the outer one.
const savepointDb = {
  query(text, params) {
    if (text === "begin") return client.query("savepoint job");
    if (text === "commit") return client.query("release savepoint job");
    if (text === "rollback") return client.query("rollback to savepoint job");
    return client.query(text, params);
  },
};

await client.connect();
try {
  await client.query("begin");
  for (const fileName of fs.readdirSync(path.join("supabase", "migrations")).sort()) {
    if (!/_(stockout_forecast|forecast_live)\.sql$/.test(fileName)) continue;
    const version = fileName.split("_")[0];
    const { rows } = await client.query(
      "select 1 from supabase_migrations.schema_migrations where version = $1",
      [version],
    );
    if (rows.length === 0) {
      await client.query(fs.readFileSync(path.join("supabase", "migrations", fileName), "utf8"));
      console.log(`${fileName}: applied inside the transaction`);
    }
  }

  await client.query("update public.model_versions set status = 'retired' where status = 'live'");
  await client.query(
    `insert into public.model_versions
       (id, kind, artifact_path, artifact_sha256, trained_from, trained_to, evaluation, status)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, 'live')
     on conflict (id) do update set status = 'live'`,
    [
      artifact.id,
      artifact.kind,
      `${artifact.id}.json`,
      digest,
      artifact.trainedFrom,
      artifact.trainedTo,
      JSON.stringify(artifact.evaluation),
    ],
  );
  await client.query("set role bloodlink_ml");
  const jobs = createForecastJobs({ db: savepointDb, loadArtifact: async () => artifact });

  // ── scoring the latest grid time ───────────────────────────────────────────
  const started = Date.now();
  const latest = await jobs.score();
  const scoreSeconds = (Date.now() - started) / 1000;
  check(
    "the scoring job scores the latest grid time",
    latest.rowsScored > 5000,
    `${latest.rowsScored} cases at ${latest.banks} banks, ${new Date(latest.asOf).toISOString()}, ${scoreSeconds.toFixed(1)} s`,
  );
  const spread = await one(
    `select min(p[2]) as low, max(p[2]) as high, avg(p[2]) as mean,
            count(*) filter (where jsonb_array_length(reasons) between 1 and 3) as with_reasons,
            count(*) as n
     from public.stock_forecasts where as_of = $1`,
    [new Date(latest.asOf).toISOString()],
  );
  check(
    "its probabilities are in 0 to 1, with reasons",
    spread.low >= 0 && spread.high <= 1 && Number(spread.with_reasons) > 0,
    `P48 ${Number(spread.low).toFixed(4)} to ${Number(spread.high).toFixed(4)}, mean ${Number(spread.mean).toFixed(4)}; ${spread.with_reasons} of ${spread.n} with reasons`,
  );
  const again = await jobs.score();
  check(
    "scoring the same grid time again is skipped",
    again.rowsScored === 0 && Boolean(again.skipped),
  );

  // ── a day 4 days back, then the daily job ──────────────────────────────────
  const dayStart =
    Math.floor((latestGridTime(Date.now() - 4 * DAY) + 5.5 * HOUR) / DAY) * DAY - 5.5 * HOUR;
  let pastRows = 0;
  for (let slot = 0; slot < 4; slot += 1) {
    pastRows += (await jobs.score({ asOf: dayStart + slot * 6 * HOUR })).rowsScored;
  }
  check("four grid times of a past day are scored", pastRows > 20000, `${pastRows} cases`);
  const end = await jobs.dataEnd();
  check(
    "the data's end is the newest complete cloud sweep",
    end !== null,
    end && new Date(end).toISOString(),
  );
  const daily = await jobs.daily();
  check(
    "the daily job labels the four grid times",
    daily.labelled.length === 4,
    daily.labelled.join(", "),
  );
  const labels = await one(
    `select count(*) as n,
            count(*) filter (where stockout[2]) as low48,
            count(*) filter (where stockout[2] is null) as left_out48
     from public.forecast_outcomes where as_of = any ($1::timestamptz[])`,
    [daily.labelled],
  );
  check(
    "with outcomes by the model's threshold",
    Number(labels.n) === pastRows,
    `${labels.n} cases; ${labels.low48} fell to ${thresholdOf(artifact)} or fewer within 48 h, ${labels.left_out48} left out`,
  );
  check("and calibrates that day", daily.day !== null, daily.day);
  const metrics = await client.query(
    `select horizon_h, cases, positives, pr_auc, calibration_ratio, platt_a, platt_b, cut_off,
            recall_at_cut_off, false_alerts_per_bank_week
     from public.forecast_daily_metrics where day = $1 order by horizon_h`,
    [daily.day],
  );
  check("recording metrics for 24, 48 and 72 h", metrics.rows.length === 3);
  for (const row of metrics.rows) {
    console.log(
      `      ${row.horizon_h} h: ${row.cases} cases, ${row.positives} fell low; PR-AUC ${Number(row.pr_auc).toFixed(3)}, predicted / observed ${Number(row.calibration_ratio).toFixed(2)}, false alerts ${Number(row.false_alerts_per_bank_week).toFixed(2)} per bank per week, caught ${(100 * row.recall_at_cut_off).toFixed(1)}%; next Platt (${Number(row.platt_a).toFixed(3)}, ${Number(row.platt_b).toFixed(3)}), cut-off ${Number(row.cut_off).toFixed(3)}`,
    );
  }
  console.log(`      kill switch: ${JSON.stringify(daily.killSwitch)}`);
  check("the kill switch ran", typeof daily.killSwitch?.shouldStop === "boolean");
  const rescored = await jobs.score({ asOf: latest.asOf - 6 * HOUR });
  check(
    "a later scoring run uses the daily calibration",
    rescored.calibration === "daily",
    rescored.calibration,
  );

  // ── what search sees ───────────────────────────────────────────────────────
  await client.query("reset role");
  const codes = (
    await client.query(
      "select hospital_code from public.stock_forecasts where as_of = $1 and blood_group_code = $2 limit 50",
      [new Date(latest.asOf).toISOString(), GROUP_CODES["O+Ve"]],
    )
  ).rows.map((row) => row.hospital_code);
  await client.query("update public.feature_flags set is_enabled = false");
  await client.query("set role anon");
  const off = (
    await one("select public.forecast_marks($1, '12', $2) as answer", [codes, GROUP_CODES["O+Ve"]])
  ).answer;
  check("with the flags off, search sees no marks", off.marks.length === 0 && !off.showBadge);
  check(
    "anon can't post or schedule jobs",
    (await errorCode('select public.forecast_post(\'{"job": "score"}\'::jsonb)')) === "42501" &&
      (await errorCode("select public.schedule_stock_forecast()")) === "42501",
  );
  check(
    "anon can't read the forecast tables",
    (await errorCode("select 1 from public.stock_forecasts limit 1")) === "42501",
  );
  await client.query("reset role");
  await client.query(
    "update public.feature_flags set is_enabled = true where name in ('forecast_badge', 'forecast_ranking')",
  );
  await client.query("set role anon");
  const on = (
    await one("select public.forecast_marks($1, '12', $2) as answer", [codes, GROUP_CODES["O+Ve"]])
  ).answer;
  const flagged = on.marks.filter((mark) => mark.p[1] > on.cutOff).length;
  check(
    "with them on, search sees each bank's latest scores, the cut-off and the threshold",
    on.marks.length === codes.length &&
      on.showBadge &&
      on.useInRanking &&
      on.thresholdUnits === thresholdOf(artifact),
    `${on.marks.length} banks, cut-off ${Number(on.cutOff).toFixed(3)}, ${flagged} would be marked`,
  );
  check(
    "too many bank codes are refused",
    (await errorCode("select public.forecast_marks($1, '12', '15')", [
      Array.from({ length: 501 }, (_, index) => String(index)),
    ])) === "22023",
  );
  await client.query("reset role");
} catch (error) {
  check("the dry run", false, error.message);
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
console.log(
  failures === 0
    ? "All checks passed; everything was rolled back."
    : `${failures} check(s) failed; everything was rolled back.`,
);
process.exitCode = failures === 0 ? 0 : 1;
