// Phase 0 of the cloud collector (docs/report3.md, point 3.1): checks, before anything is built on
// it, that a Supabase Edge Function can do the collector's work. On the project in
// SUPABASE_DB_URL it deploys the throwaway collector-probe function, calls it with
// x-region: ap-south-1 and then without, and deletes it and its secret again.
// Needs `npx supabase login` once. Makes four eRaktKosh calls in all.
//
// Usage: node scripts/probe-cloud-collector.mjs
// The answers are printed and saved to ../blood_data/measurements/ when it exists.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SUPABASE_CLI = "supabase@3.0.0";
const MEASUREMENTS_DIR = path.join("..", "blood_data", "measurements");

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  console.error("SUPABASE_DB_URL is not set (add it to .env.local).");
  process.exit(1);
}
const ref = decodeURIComponent(new URL(databaseUrl).username).split(".")[1];
const probeUrl = `https://${ref}.supabase.co/functions/v1/collector-probe`;

// Runs the Supabase CLI; on Windows npx is a .cmd, which needs a shell. Arguments
// are plain words and base64url, so the shell has nothing to expand.
function supabase(cliArgs) {
  const result = spawnSync("npx", ["--yes", SUPABASE_CLI, ...cliArgs, `--remote=${ref}`, "--yes"], {
    stdio: ["ignore", "inherit", "inherit"],
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(`supabase ${cliArgs.slice(0, 2).join(" ")} failed`);
}

async function callProbe(secret, region) {
  const started = Date.now();
  const response = await fetch(probeUrl, {
    method: "POST",
    headers: { "x-collector-secret": secret, ...(region ? { "x-region": region } : {}) },
    signal: AbortSignal.timeout(150_000),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 500);
  }
  return {
    requestedRegion: region,
    status: response.status,
    edgeRegion: response.headers.get("x-sb-edge-region"),
    totalMs: Date.now() - started,
    body,
  };
}

const secret = crypto.randomBytes(32).toString("base64url");
const results = { project: ref, at: new Date().toISOString(), calls: [] };
let isDeployed = false;
try {
  supabase(["secrets", "set", `COLLECTOR_PROBE_SECRET=${secret}`]);
  supabase(["functions", "deploy", "collector-probe", "--use-api", "--no-verify-jwt"]);
  isDeployed = true;
  for (const region of ["ap-south-1", null]) {
    if (results.calls.length > 0) await new Promise((resolve) => setTimeout(resolve, 5_000));
    results.calls.push(await callProbe(secret, region));
  }
} catch (error) {
  results.error = error.message;
} finally {
  try {
    if (isDeployed) supabase(["functions", "delete", "collector-probe"]);
    supabase(["secrets", "unset", "COLLECTOR_PROBE_SECRET"]);
  } catch (error) {
    results.cleanupError = `${error.message}; delete collector-probe in the dashboard`;
  }
}

console.log(JSON.stringify(results, null, 2));
if (fs.existsSync(MEASUREMENTS_DIR)) {
  const outFile = path.join(MEASUREMENTS_DIR, `collector_probe_${results.at.slice(0, 10)}.json`);
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(`saved ${outFile}`);
}
process.exit(results.error || results.cleanupError ? 1 : 0);
