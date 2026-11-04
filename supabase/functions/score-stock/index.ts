// score-stock: the stock-out forecast's scheduled jobs (docs/PLANS/ML_system.md,
// A3 and A4). pg_cron posts { job: "score" } after each grid time and
// { job: "daily" } once a day; see supabase/migrations/*_forecast_live.sql.
//
// The jobs are src/lib/forecastJobs.js. This file adds the secret check, a pg
// session as bloodlink_ml, and the live model's artifact from the private ml-models
// bucket, checked against its SHA-256 in model_versions. It is deployed with JWT
// verification off, since the cron call carries no user, so the x-forecast-secret
// header is the only way in.
// Deploy with: node scripts/setup-forecast.mjs --deploy-only

import pg from "npm:pg@8.23.1";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { isCollectorSecret } from "../../../src/lib/collector.js";
import { createForecastJobs, parseForecastRequest } from "../../../src/lib/forecastJobs.js";

const BUCKET = "ml-models";

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// The built-in secret key reaches every bucket, so it is used for nothing but
// reading the artifact. Database work goes through bloodlink_ml.
async function loadArtifact(model: { id: string; artifact_path: string; artifact_sha256: string }) {
  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  if (!secretKeys.default) throw new Error("SUPABASE_SECRET_KEYS has no default key");
  const bucket = createClient(Deno.env.get("SUPABASE_URL")!, secretKeys.default, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage.from(BUCKET);
  const { data, error } = await bucket.download(model.artifact_path);
  if (error || !data) throw new Error(`download ${model.artifact_path}: ${error?.message ?? "empty"}`);
  const buffer = await data.arrayBuffer();
  const digest = await sha256Hex(buffer);
  if (digest !== model.artifact_sha256) {
    throw new Error(`${model.artifact_path}: SHA-256 ${digest} is not model_versions' ${model.artifact_sha256}`);
  }
  return JSON.parse(new TextDecoder().decode(buffer));
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return respond(405, { error: "POST only" });
  if (!isCollectorSecret(request.headers.get("x-forecast-secret"), Deno.env.get("FORECAST_SECRET"))) {
    return respond(401, { error: "unauthorized" });
  }
  const job = parseForecastRequest(await request.json().catch(() => null));
  if (job.error) return respond(400, { error: job.error });

  const client = new pg.Client({ connectionString: Deno.env.get("SUPABASE_DB_URL") });
  try {
    await client.connect();
    await client.query("set role bloodlink_ml");
    const jobs = createForecastJobs({ db: client, loadArtifact, log: console.log });
    const result = job.job === "score" ? await jobs.score({ asOf: job.asOf }) : await jobs.daily();
    return respond(200, result);
  } catch (error) {
    console.error(`${job.job} failed: ${(error as Error).message}`);
    return respond(500, { error: (error as Error).message });
  } finally {
    await client.end().catch(() => {});
  }
});
