// Saves eRaktKosh data into the stock store (supabase/migrations/*_stock_store.sql)
// for the search fallback and for stock history. Meant to run at most hourly.
//
//   node scripts/snapshot.mjs --all                     every state, 1 s apart
//   node scripts/snapshot.mjs --states 30,99            some states
//   node scripts/snapshot.mjs --directory               nationwide "nearest" directory (weekly)
//   add --archive <dir>  to also append each sweep's changes to local files
//   add --prune          to trim history older than 60 days and call logs older than 90
//   add --log <file>     to append all output to a file (the scheduled task uses this)
//
// The collecting itself is src/lib/collector.js, which the collect-stock Edge
// Function shares. This file is its Node wrapper: flags, the log file, a pg
// connection and the local archive. The session runs as the bloodlink_ingest
// role, which can only touch the stock tables.

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { createCollector } from "../src/lib/collector.js";

const args = process.argv.slice(2);
const argValue = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? null);
};
const isDirectoryRun = args.includes("--directory");
const isAllStates = args.includes("--all");
const requestedStates =
  argValue("--states")
    ?.split(",")
    .map((code) => code.trim()) ?? [];
const archiveDir = argValue("--archive");
const shouldPrune = args.includes("--prune");
const logFile = argValue("--log");

// With --log, output goes to the file, each run headed by its start time and flags.
if (logFile) {
  const write = (text) => fs.appendFileSync(logFile, `${text}\n`);
  write(`=== ${new Date().toISOString()} snapshot ${args.join(" ")}`);
  console.log = (...parts) =>
    write(parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" "));
  console.error = console.log;
}

// The scheduled run was twice stopped by a console signal after its first state.
// Record any signal with the time, and carry on after Ctrl+C or Ctrl+Break; a
// console close (SIGHUP) still ends the run, but the log now says so.
for (const signal of ["SIGINT", "SIGBREAK", "SIGHUP", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`received ${signal} at ${new Date().toISOString()}`);
    if (signal === "SIGHUP" || signal === "SIGTERM") process.exit(1);
  });
}
if (!isDirectoryRun && !isAllStates && requestedStates.length === 0 && !shouldPrune) {
  console.error(
    "Usage: node scripts/snapshot.mjs --all | --states 30,99 | --directory [--archive <dir>] [--prune]",
  );
  process.exit(1);
}

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  console.error("SUPABASE_DB_URL is not set (add it to .env.local).");
  process.exit(1);
}

const districtData = JSON.parse(fs.readFileSync("assets/district_data.json", "utf8"));
const knownStateCodes = districtData.statesWithDistricts.map((state) => String(state.stateCode));
const stateCodes = isAllStates ? knownStateCodes : requestedStates;
for (const stateCode of stateCodes) {
  if (!knownStateCodes.includes(stateCode)) {
    console.error(`Unknown state code ${stateCode}.`);
    process.exit(1);
  }
}

// The local archive: changed rows per UTC day, one line per sweep, and the weekly
// directory answer, all under --archive.
function appendArchive(fileName, lines) {
  if (lines.length === 0) return;
  fs.mkdirSync(path.dirname(path.join(archiveDir, fileName)), { recursive: true });
  fs.appendFileSync(
    path.join(archiveDir, fileName),
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
  );
}
const localArchive = archiveDir && {
  history: (lines) => appendArchive(`history/${lines[0]?.fetchedAt.slice(0, 10)}.ndjson`, lines),
  sweep: (summary) => appendArchive("sweeps.ndjson", [summary]),
  directory: (data, seenAt) => {
    fs.mkdirSync(path.join(archiveDir, "directory"), { recursive: true });
    fs.writeFileSync(
      path.join(archiveDir, "directory", `${seenAt.slice(0, 10)}.json`),
      JSON.stringify(data),
    );
  },
};

// Errors from here on are logged before the process exits, so a failed run shows in
// --log as well as in the exit code the scheduled task records.
const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
let isSuccess = true;
try {
  await client.connect();
  await client.query("set role bloodlink_ingest");
  // Runs are recorded in collector_runs once the cloud collector's migration is in.
  const { rows } = await client.query("select to_regclass('public.collector_runs') as runs");
  const collector = createCollector({
    db: client,
    fetch,
    districtData,
    stateBoundaries: isDirectoryRun
      ? JSON.parse(fs.readFileSync("assets/state_boundaries.json", "utf8"))
      : null,
    archive: localArchive,
    runner: "laptop",
    recordRuns: rows[0].runs !== null,
  });
  // Each job's outcome goes to collector_runs; a job that throws is recorded too.
  const runJob = async (job, work) => {
    const run = await collector.startRun({ job });
    try {
      const outcome = await work();
      await collector.finishRun(run, outcome);
      return outcome;
    } catch (error) {
      await collector.finishRun(run, { error: error.message }).catch(() => {});
      throw error;
    }
  };
  if (isDirectoryRun) {
    const outcome = await runJob("directory", async () => {
      const directory = await collector.collectDirectory();
      return { ...directory, result: directory.qualityCounts };
    });
    isSuccess = outcome.isSuccess && isSuccess;
  }
  if (stateCodes.length > 0) {
    const outcome = await runJob("stock", () => collector.collectStates(stateCodes));
    isSuccess = outcome.isSuccess && isSuccess;
  }
  if (shouldPrune) await runJob("prune", async () => ({ result: await collector.prune() }));
} catch (error) {
  console.error(`fatal: ${error.message}`);
  isSuccess = false;
} finally {
  await client.end().catch(() => {});
}
process.exit(isSuccess ? 0 : 1);
