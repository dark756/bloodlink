// Sets up and runs the stock-out forecast in the cloud (docs/PLANS/ML_system.md,
// Part A) on the project in SUPABASE_DB_URL. Needs `npx supabase login` once, the
// forecast's migrations applied (npm run db:migrate), and, for --publish,
// SUPABASE_SECRET_KEY in .env.local.
//
//   node scripts/setup-forecast.mjs                         new secret, Vault, deploy
//   node scripts/setup-forecast.mjs --deploy-only           redeploy score-stock only
//   node scripts/setup-forecast.mjs --publish ml/models/<id>.json [--live]
//   node scripts/setup-forecast.mjs --schedule | --unschedule
//   node scripts/setup-forecast.mjs --run score|daily       one job now; waits for it
//   node scripts/setup-forecast.mjs --flags on|off          the badge and ranking flags
//
// --publish checks the artifact against its .sha256 file and stockoutModel.js's
// validator, uploads it to the private ml-models bucket and registers it in
// model_versions, in shadow, or live with --live (retiring the live one). The first
// form, which also rotates the secret, stores it as the function's FORECAST_SECRET and
// in Vault as forecast_secret, with the function's URL as forecast_url, then deploys
// score-stock with JWT verification off (the secret guards it). The secret goes from
// memory to the CLI and the database, never into a file.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { thresholdOf, validateArtifact } from "../src/lib/stockoutModel.js";

const SUPABASE_CLI = "supabase@3.0.0";
const BUCKET = "ml-models";
const FLAGS = ["forecast_badge", "forecast_ranking"];
const RUN_WAIT_MS = 170_000;
const args = process.argv.slice(2);
const argValue = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? null);
};

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  console.error("SUPABASE_DB_URL is not set (add it to .env.local).");
  process.exit(1);
}
const ref = decodeURIComponent(new URL(databaseUrl).username).split(".")[1];
const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!ref || !publicUrl || new URL(publicUrl).host !== `${ref}.supabase.co`) {
  console.error("SUPABASE_DB_URL and NEXT_PUBLIC_SUPABASE_URL must name the same project.");
  process.exit(1);
}
const functionUrl = `https://${ref}.supabase.co/functions/v1/score-stock`;

function supabase(cliArgs) {
  const result = spawnSync("npx", ["--yes", SUPABASE_CLI, ...cliArgs, `--remote=${ref}`, "--yes"], {
    stdio: ["ignore", "inherit", "inherit"],
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(`supabase ${cliArgs[0]} ${cliArgs[1] ?? ""} failed`);
}
const deploy = () =>
  supabase(["functions", "deploy", "score-stock", "--use-api", "--no-verify-jwt"]);

// The artifact and its recorded hash, checked; throws on any mismatch.
function readArtifact(file) {
  const bytes = fs.readFileSync(file);
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  const sidecar = file.replace(/\.json$/, ".sha256");
  const recorded = fs.existsSync(sidecar) ? fs.readFileSync(sidecar, "utf8").split(/\s+/)[0] : null;
  if (recorded !== digest) throw new Error(`${file}: SHA-256 ${digest} doesn't match ${sidecar}`);
  const checked = validateArtifact(JSON.parse(bytes.toString("utf8")));
  if (checked.error) throw new Error(`${file}: ${checked.error}`);
  if (path.basename(file) !== `${checked.artifact.id}.json`) {
    throw new Error(`${file}: the file must be named after its id, ${checked.artifact.id}.json`);
  }
  return { artifact: checked.artifact, bytes, digest };
}

async function publish(client, file, isLive) {
  const { artifact, bytes, digest } = readArtifact(file);
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) throw new Error("SUPABASE_SECRET_KEY is not set (add it to .env.local)");
  const bucket = createClient(publicUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage.from(BUCKET);
  const artifactPath = `${artifact.id}.json`;
  const { error } = await bucket.upload(artifactPath, bytes, {
    contentType: "application/json",
    upsert: false,
  });
  if (error && !/exists/i.test(error.message)) throw new Error(`upload: ${error.message}`);
  if (error) {
    // Already there: it must be the same file.
    const { data, error: readError } = await bucket.download(artifactPath);
    if (readError) throw new Error(`download: ${readError.message}`);
    const stored = crypto
      .createHash("sha256")
      .update(Buffer.from(await data.arrayBuffer()))
      .digest("hex");
    if (stored !== digest) throw new Error(`${artifactPath} in ${BUCKET} is a different file`);
  }
  await client.query("begin");
  try {
    if (isLive) {
      await client.query(
        "update public.model_versions set status = 'retired' where status = 'live' and id <> $1",
        [artifact.id],
      );
    }
    await client.query(
      `insert into public.model_versions
         (id, kind, artifact_path, artifact_sha256, trained_from, trained_to, evaluation, status)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       on conflict (id) do update set status = excluded.status
       where public.model_versions.artifact_sha256 = excluded.artifact_sha256`,
      [
        artifact.id,
        artifact.kind,
        artifactPath,
        digest,
        artifact.trainedFrom,
        artifact.trainedTo,
        JSON.stringify(artifact.evaluation ?? {}),
        isLive ? "live" : "shadow",
      ],
    );
    await client.query("commit");
  } catch (insertError) {
    await client.query("rollback").catch(() => {});
    throw insertError;
  }
  console.log(
    `published ${artifact.id} (${isLive ? "live" : "shadow"}), predicting ${thresholdOf(artifact)} or fewer units, sha256 ${digest}`,
  );
}

// Posts one job through forecast_post() and waits for its forecast_runs row.
async function runNow(client, job) {
  const { rows: before } = await client.query("select now() as at");
  const { rows } = await client.query("select public.forecast_post($1::jsonb) as request", [
    JSON.stringify({ job }),
  ]);
  console.log(`posted ${job} (pg_net request ${rows[0].request}); waiting for its run...`);
  const deadline = Date.now() + RUN_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const { rows: runs } = await client.query(
      `select id, as_of, finished_at, rows_scored, result, error from public.forecast_runs
       where job = $1 and started_at >= $2 order by started_at desc limit 1`,
      [job, before[0].at],
    );
    if (runs[0]?.finished_at) {
      console.log(JSON.stringify(runs[0], null, 1));
      if (runs[0].error) process.exitCode = 1;
      return;
    }
  }
  console.log("No finished run yet; check forecast_runs and net._http_response.");
  process.exitCode = 1;
}

async function setFlags(client, isEnabled) {
  await client.query("begin");
  try {
    const { rows } = await client.query(
      `update public.feature_flags
       set is_enabled = $1, disabled_reason = case when $1 then null else disabled_reason end,
           updated_by = null, updated_at = now()
       where name = any ($2) returning name`,
      [isEnabled, FLAGS],
    );
    await client.query(
      `insert into public.audit_log (actor_id, action, target_type, target_id, details)
       values (null, 'feature_flag.changed', 'feature_flag', null, $1::jsonb)`,
      [
        JSON.stringify({
          flags: rows.map((row) => row.name),
          to: isEnabled,
          by: "setup-forecast.mjs",
        }),
      ],
    );
    await client.query("commit");
    console.log(`${rows.map((row) => row.name).join(", ")}: ${isEnabled ? "on" : "off"}`);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const { rows } = await client.query(
    "select to_regprocedure('public.schedule_stock_forecast()') is not null as ready",
  );
  if (!rows[0].ready) throw new Error("apply the forecast's migrations first (npm run db:migrate)");

  if (args.includes("--deploy-only")) {
    deploy();
  } else if (args.includes("--publish")) {
    const file = argValue("--publish");
    if (!file) throw new Error("give the artifact: --publish ml/models/<id>.json");
    await publish(client, file, args.includes("--live"));
  } else if (args.includes("--schedule")) {
    const { rows: scheduled } = await client.query(
      "select public.schedule_stock_forecast() as jobs",
    );
    console.log("scheduled:", scheduled[0].jobs);
    console.log("Scoring at 00:05, 06:05, 12:05 and 18:05 India time; the daily job at 03:15.");
  } else if (args.includes("--unschedule")) {
    const { rows: removed } = await client.query("select public.unschedule_stock_forecast() as n");
    console.log(`unscheduled ${removed[0].n} job(s)`);
  } else if (args.includes("--run")) {
    const job = argValue("--run");
    if (job !== "score" && job !== "daily") throw new Error("--run takes score or daily");
    await runNow(client, job);
  } else if (args.includes("--flags")) {
    const value = argValue("--flags");
    if (value !== "on" && value !== "off") throw new Error("--flags takes on or off");
    await setFlags(client, value === "on");
  } else {
    const secret = crypto.randomBytes(32).toString("base64url");
    supabase(["secrets", "set", `FORECAST_SECRET=${secret}`]);
    for (const [name, value] of [
      ["forecast_url", functionUrl],
      ["forecast_secret", secret],
    ]) {
      const { rows: existing } = await client.query(
        "select id from vault.secrets where name = $1",
        [name],
      );
      if (existing.length > 0) {
        await client.query("select vault.update_secret($1, $2)", [existing[0].id, value]);
      } else {
        await client.query("select vault.create_secret($1, $2)", [value, name]);
      }
    }
    console.log(`Vault: forecast_url = ${functionUrl}, forecast_secret set.`);
    deploy();
    console.log(
      "Deployed. Next: --publish ml/models/<id>.json --live, then --run score, --schedule, --flags on.",
    );
  }
} catch (error) {
  console.error(`failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
