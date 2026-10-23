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
// Rows are validated with src/lib/stockQuality.js, the same code the app uses.
// The session runs as the bloodlink_ingest role, which can only touch the stock tables.

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { validateAvailabilityRows } from "../src/lib/stockQuality.js";
import { cleanText, parseEntryDate, parseQuantities } from "../src/lib/stock.js";
import { createStateChecker } from "../src/lib/stateBounds.js";

const BASE_URL = "https://eraktkosh.mohfw.gov.in/eraktkoshPortal/eraktkosh/";
const TIMEOUT_MS = 60_000;
const STATE_GAP_MS = 1_000;
const BATCH_SIZE = 400;
// One call from central India with a 5,000 km radius returns every bank with coordinates.
const DIRECTORY_QUERY = { latitude: 22, longitude: 79, radius: 5_000_000 };

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
const stateNames = new Map(
  districtData.statesWithDistricts.map((state) => [String(state.stateCode), state.stateName]),
);
const componentShortNames = new Map(
  districtData.componentList.map((component) => [
    component.componentName.toLowerCase(),
    component.componentShortName,
  ]),
);
const stateChecker = createStateChecker(
  JSON.parse(fs.readFileSync("assets/state_boundaries.json", "utf8")),
);
const stateCodes = isAllStates ? [...stateNames.keys()] : requestedStates;
for (const stateCode of stateCodes) {
  if (!stateNames.has(stateCode)) {
    console.error(`Unknown state code ${stateCode}.`);
    process.exit(1);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const digitsOrNull = (value, maxLength) => {
  const text = value === null || value === undefined ? "" : String(value).trim();
  return new RegExp(`^[0-9]{1,${maxLength}}$`).test(text) ? text : null;
};
const toIsoOrNull = (entryDate) => parseEntryDate(entryDate)?.toISOString() ?? null;

// GET an eRaktKosh endpoint. Returns { ok, data, status, durationMs, bytes, failureKind }.
async function callEraktkosh(endpoint, params) {
  const started = Date.now();
  const url = `${BASE_URL}${endpoint}?${new URLSearchParams(params)}`;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    const durationMs = Date.now() - started;
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        durationMs,
        bytes: text.length,
        failureKind: "http",
      };
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (!Array.isArray(data)) {
      return {
        ok: false,
        status: response.status,
        durationMs,
        bytes: text.length,
        failureKind: "shape",
      };
    }
    return { ok: true, data, status: response.status, durationMs, bytes: text.length };
  } catch (error) {
    const failureKind = error.name === "TimeoutError" ? "timeout" : "network";
    return { ok: false, status: null, durationMs: Date.now() - started, bytes: 0, failureKind };
  }
}

// Multi-row INSERT in batches. rows: arrays of values in column order.
async function insertRows(client, table, columns, rows, conflictClause, casts = {}) {
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    const values = [];
    const tuples = batch.map((row, rowIndex) => {
      const placeholders = row.map((value, columnIndex) => {
        values.push(value);
        const cast = casts[columns[columnIndex]] ?? "";
        return `$${rowIndex * columns.length + columnIndex + 1}${cast}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await client.query(
      `insert into public.${table} (${columns.join(", ")}) values ${tuples.join(", ")} ${conflictClause}`,
      values,
    );
  }
}

async function logCall(client, endpoint, stateCode, call, rowCount, quality) {
  await client.query(
    `insert into public.upstream_calls
       (endpoint, state_code, ok, http_status, duration_ms, bytes, rows, failure_kind, quality)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      endpoint,
      stateCode,
      call.ok,
      call.status,
      call.durationMs,
      call.bytes,
      rowCount,
      call.ok ? null : call.failureKind,
      quality ? JSON.stringify(quality) : null,
    ],
  );
}

// {"PRBC": {"O+Ve": 74}, ...}: the compact copy kept in stock_history.
function compactStock(row) {
  const stock = {};
  for (const [componentName, component] of Object.entries(row.components ?? {})) {
    const groups = Object.fromEntries(
      parseQuantities(component?.available_WithQty)
        .filter((entry) => entry.units > 0)
        .map((entry) => [entry.group, entry.units]),
    );
    if (Object.keys(groups).length === 0) continue;
    stock[componentShortNames.get(componentName.toLowerCase()) ?? componentName] = groups;
  }
  return stock;
}

function appendArchive(fileName, lines) {
  if (!archiveDir || lines.length === 0) return;
  fs.mkdirSync(path.dirname(path.join(archiveDir, fileName)), { recursive: true });
  fs.appendFileSync(
    path.join(archiveDir, fileName),
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
  );
}

async function snapshotDirectory(client) {
  const call = await callEraktkosh("bloodbank/nearest", DIRECTORY_QUERY);
  if (!call.ok) {
    await logCall(client, "bloodbank/nearest", null, call, null, null);
    console.error(`directory: failed (${call.failureKind})`);
    return false;
  }
  const pointCounts = new Map();
  const pointKey = (bank) =>
    `${Number(bank.latitude).toFixed(5)},${Number(bank.longitude).toFixed(5)}`;
  for (const bank of call.data)
    pointCounts.set(pointKey(bank), (pointCounts.get(pointKey(bank)) ?? 0) + 1);

  const seenAt = new Date().toISOString();
  const banksByCode = new Map();
  for (const bank of call.data) {
    const hospitalCode = digitsOrNull(bank.hospitalCode, 10);
    if (!hospitalCode) continue;
    const latitude = Number.isFinite(Number(bank.latitude)) ? Number(bank.latitude) : null;
    const longitude = Number.isFinite(Number(bank.longitude)) ? Number(bank.longitude) : null;
    // missing, outside_india or wrong_state (outside its own state), else shared or ok.
    const locationQuality =
      stateChecker.locationProblem({ latitude, longitude, stateCode: bank.stateCode }) ??
      (pointCounts.get(pointKey(bank)) > 1 ? "shared" : "ok");
    banksByCode.set(hospitalCode, [
      hospitalCode,
      (cleanText(bank.name) || "Blood bank").slice(0, 300),
      cleanText(bank.address) || null,
      bank.phone ? String(bank.phone).trim() : null,
      bank.email ? String(bank.email).trim() : null,
      digitsOrNull(bank.stateCode, 3),
      digitsOrNull(bank.distId, 5),
      latitude,
      longitude,
      locationQuality,
      bank.type ?? null,
      bank.hospitalType ? String(bank.hospitalType).trim() : null,
      Number.isInteger(bank.stockSource) ? bank.stockSource : null,
      Number.isInteger(bank.campSource) ? bank.campSource : null,
      seenAt,
    ]);
  }
  const rows = [...banksByCode.values()];
  await insertRows(
    client,
    "blood_banks",
    [
      "hospital_code",
      "name",
      "address",
      "phone",
      "email",
      "state_code",
      "district_id",
      "latitude",
      "longitude",
      "location_quality",
      "bank_type",
      "hospital_type",
      "stock_source",
      "camp_source",
      "last_seen_at",
    ],
    rows,
    `on conflict (hospital_code) do update set name = excluded.name, address = excluded.address,
       phone = excluded.phone, email = excluded.email, state_code = excluded.state_code,
       district_id = excluded.district_id, latitude = excluded.latitude,
       longitude = excluded.longitude, location_quality = excluded.location_quality,
       bank_type = excluded.bank_type, hospital_type = excluded.hospital_type,
       stock_source = excluded.stock_source, camp_source = excluded.camp_source,
       last_seen_at = excluded.last_seen_at`,
  );
  const qualityCounts = {};
  for (const row of rows) qualityCounts[row[9]] = (qualityCounts[row[9]] ?? 0) + 1;
  await logCall(client, "bloodbank/nearest", null, call, rows.length, qualityCounts);
  if (archiveDir) {
    fs.mkdirSync(path.join(archiveDir, "directory"), { recursive: true });
    fs.writeFileSync(
      path.join(archiveDir, "directory", `${seenAt.slice(0, 10)}.json`),
      JSON.stringify(call.data),
    );
  }
  console.log(`directory: ${rows.length} banks in ${call.durationMs} ms`, qualityCounts);
  return true;
}

async function snapshotStates(client) {
  const { rows: directoryRows } = await client.query(
    "select hospital_code, district_id from public.blood_banks",
  );
  const districtByCode = new Map(directoryRows.map((row) => [row.hospital_code, row.district_id]));
  const sweepStartedAt = new Date().toISOString();
  const sweep = { startedAt: sweepStartedAt, states: [] };
  let okCount = 0;

  for (const [index, stateCode] of stateCodes.entries()) {
    if (index > 0) await sleep(STATE_GAP_MS);
    const call = await callEraktkosh("blood-availability", { stateCode });
    if (!call.ok) {
      await logCall(client, "blood-availability", stateCode, call, null, null);
      sweep.states.push({
        stateCode,
        ok: false,
        failureKind: call.failureKind,
        ms: call.durationMs,
      });
      console.error(`${stateNames.get(stateCode)}: failed (${call.failureKind})`);
      continue;
    }
    const fetchedAt = new Date().toISOString();
    const { rows, report } = validateAvailabilityRows(call.data, { now: new Date() });
    const { rows: previousRows } = await client.query(
      "select hospital_code, entry_at from public.bank_stock_latest where state_code = $1",
      [stateCode],
    );
    const previousEntry = new Map(
      previousRows.map((row) => [row.hospital_code, row.entry_at?.toISOString() ?? null]),
    );

    // Full rows go up only for banks whose update time changed (or that are new);
    // the rest just get a new fetch time. That keeps each hourly upload small.
    const isChanged = (row) =>
      !previousEntry.has(row.hospitalCode) ||
      previousEntry.get(row.hospitalCode) !== toIsoOrNull(row.entrydate);
    const changedRows = rows.filter(isChanged);
    const unchangedCodes = rows.filter((row) => !isChanged(row)).map((row) => row.hospitalCode);
    const latestRows = changedRows.map((row) => [
      row.hospitalCode,
      stateCode,
      districtByCode.get(row.hospitalCode) ?? null,
      JSON.stringify(row),
      toIsoOrNull(row.entrydate),
      fetchedAt,
    ]);
    const historyRows = changedRows
      .filter((row) => toIsoOrNull(row.entrydate) !== null)
      .map((row) => [
        row.hospitalCode,
        toIsoOrNull(row.entrydate),
        fetchedAt,
        stateCode,
        JSON.stringify(compactStock(row)),
      ]);

    await client.query("begin");
    try {
      await insertRows(
        client,
        "bank_stock_latest",
        ["hospital_code", "state_code", "district_id", "row", "entry_at", "fetched_at"],
        latestRows,
        `on conflict (hospital_code) do update set state_code = excluded.state_code,
           district_id = excluded.district_id, row = excluded.row,
           entry_at = excluded.entry_at, fetched_at = excluded.fetched_at`,
        { row: "::jsonb" },
      );
      if (unchangedCodes.length > 0) {
        await client.query(
          "update public.bank_stock_latest set fetched_at = $1 where hospital_code = any($2::text[])",
          [fetchedAt, unchangedCodes],
        );
      }
      await insertRows(
        client,
        "stock_history",
        ["hospital_code", "entry_at", "fetched_at", "state_code", "stock"],
        historyRows,
        "on conflict (hospital_code, entry_at) do nothing",
        { stock: "::jsonb" },
      );
      await logCall(client, "blood-availability", stateCode, call, rows.length, report);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }

    appendArchive(
      `history/${fetchedAt.slice(0, 10)}.ndjson`,
      historyRows.map(([hospitalCode, entryAt, , , stock]) => ({
        fetchedAt,
        stateCode,
        hospitalCode,
        entryAt,
        stock: JSON.parse(stock),
      })),
    );
    okCount += 1;
    sweep.states.push({
      stateCode,
      ok: true,
      ms: call.durationMs,
      bytes: call.bytes,
      rows: rows.length,
      changed: historyRows.length,
      quality: report,
    });
    console.log(
      `${stateNames.get(stateCode)}: ${rows.length} banks, ${historyRows.length} changed, ${call.durationMs} ms`,
    );
  }

  sweep.finishedAt = new Date().toISOString();
  appendArchive("sweeps.ndjson", [sweep]);
  console.log(`states: ${okCount} of ${stateCodes.length} saved`);
  return okCount > 0 || stateCodes.length === 0;
}

const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
let isSuccess = true;
try {
  await client.query("set role bloodlink_ingest");
  if (isDirectoryRun) isSuccess = (await snapshotDirectory(client)) && isSuccess;
  if (stateCodes.length > 0) isSuccess = (await snapshotStates(client)) && isSuccess;
  if (shouldPrune) {
    const { rows } = await client.query("select public.prune_stock_store() as result");
    console.log("pruned:", rows[0].result);
  }
} finally {
  await client.end();
}
process.exit(isSuccess ? 0 : 1);
