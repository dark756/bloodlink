import { validateAvailabilityRows } from "./stockQuality.js";
import { cleanText, parseEntryDate, parseQuantities } from "./stock.js";
import { createStateChecker } from "./stateBounds.js";
import { haversineMeters } from "./geo.js";

// The eRaktKosh collector, shared by scripts/snapshot.mjs on the laptop and the
// collect-stock Edge Function in Supabase (docs/SUMMARIES/data_quality.md.
// For each state it fetches the stock, validates it with stockQuality.js, uploads
// the rows whose update time changed, refreshes the fetch time of the rest, adds
// history and logs the call. The weekly run saves the directory, flags banks
// outside their own state, saves the auto-refresh list, and retires corrected bank
// positions that eRaktKosh's own point has caught up with. Meant to run hourly or
// less often.
//
// The caller passes in what differs between Node and Deno:
// - db: { query(text, params) -> { rows } } on one session already switched to
//   bloodlink_ingest, since begin and commit are sent through it;
// - fetch: the standard fetch;
// - districtData and stateBoundaries: the two asset files, as objects;
// - archive (optional): { history(lines), sweep(summary), directory(data, seenAt) }.
// The explicit ".js" imports let Node and Deno load it alike.

export const BASE_URL = "https://eraktkosh.mohfw.gov.in/eraktkoshPortal/eraktkosh/";
export const TIMEOUT_MS = 60_000;
export const STATE_GAP_MS = 1_000;
const BATCH_SIZE = 400;
// One call from central India with a 5,000 km radius returns every bank with coordinates.
export const DIRECTORY_QUERY = { latitude: 22, longitude: 79, radius: 5_000_000 };
// The banks whose stock eRaktKosh refreshes automatically, in batches: a list of
// bank codes as strings. An input of the stock-out forecast (docs/PLANS/ML_system.md, A1).
export const AUTO_REFRESH_ENDPOINT = "master/portal-refresh-hospitals";
// Archive lines carry their format version; lines without one are version 1.
export const ARCHIVE_VERSION = 1;
// A batch or weekly job that ran this recently is refused, so no schedule or leaked
// secret can make collection more frequent than hourly.
export const REPEAT_GUARD_MINUTES = 50;
// A machine location fix gives way to eRaktKosh's own usable point within this distance
// of it; further away, the difference is logged for review (plan_bank_locations.md, L6).
export const SUPERSEDE_WITHIN_M = 2_000;

// The four batches of a cloud sweep, split by measured time so each takes about
// 36 s of a free Edge Function's 150 s (2026-10-23 sweep). eRaktKosh state codes.
export const STATE_BATCHES = {
  // Uttar Pradesh, Kerala, Madhya Pradesh, Delhi, Uttarakhand, Puducherry, Nagaland, Goa, Lakshadweep
  1: ["99", "32", "23", "97", "95", "34", "13", "30", "31"],
  // Andhra Pradesh, Telangana, Haryana, West Bengal, Jharkhand, Arunachal Pradesh, Meghalaya, Mizoram, Ladakh
  2: ["28", "36", "96", "19", "20", "12", "17", "15", "37"],
  // Maharashtra, Rajasthan, Gujarat, Bihar, Assam, Himachal Pradesh, Andaman and Nicobar, Manipur, DNH and DD
  3: ["27", "98", "24", "10", "18", "92", "35", "14", "25"],
  // Karnataka, Tamil Nadu, Punjab, Chhattisgarh, Odisha, Jammu and Kashmir, Tripura, Sikkim, Chandigarh
  4: ["29", "33", "93", "22", "21", "91", "16", "11", "94"],
};

// The admin overview warns when no stock run has finished for the sweep interval
// plus this long: 6.5 hours at the default 4.5.
export const OVERDUE_GRACE_HOURS = 2;
export const DEFAULT_SWEEP_HOURS = 4.5;

// Hours in a Postgres interval as PostgREST returns it: "04:30:00" or "1 day 02:00:00".
export function intervalHours(interval) {
  const match = String(interval ?? "").match(/^(?:(\d+) days? )?(\d+):(\d+):(\d+)$/);
  if (!match) return null;
  const [days, hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0));
  return days * 24 + hours + minutes / 60 + seconds / 3600;
}

// Whether collection is overdue: the hours since the last finished stock run, against
// the latest sweep's interval (the default when no cloud sweep has run) plus the grace.
export function collectionOverdue(lastFinishedAt, sweepInterval, now = new Date()) {
  const limitHours = (intervalHours(sweepInterval) ?? DEFAULT_SWEEP_HOURS) + OVERDUE_GRACE_HOURS;
  const hoursSince = lastFinishedAt ? (now - new Date(lastFinishedAt)) / 3_600_000 : null;
  return { isOverdue: hoursSince === null || hoursSince > limitHours, hoursSince, limitHours };
}

const REQUEST_KEYS = new Set(["batch", "sweep", "directory", "prune"]);

// The body of a call to the collect-stock function: { batch: 1-4, sweep? } or
// { directory?: true, prune?: true }. Returns { batch, sweepId, directory, prune }
// or { error }.
export function parseCollectorRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be a JSON object" };
  }
  const unknownKey = Object.keys(body).find((key) => !REQUEST_KEYS.has(key));
  if (unknownKey) return { error: `unknown field ${unknownKey}` };
  if (body.batch !== undefined) {
    if (!Object.hasOwn(STATE_BATCHES, body.batch) || !Number.isInteger(body.batch)) {
      return { error: "batch must be 1, 2, 3 or 4" };
    }
    if (body.directory !== undefined || body.prune !== undefined) {
      return { error: "a batch call can't also run the directory or the prune" };
    }
    if (body.sweep !== undefined && !(Number.isSafeInteger(body.sweep) && body.sweep > 0)) {
      return { error: "sweep must be a positive integer" };
    }
    return { batch: body.batch, sweepId: body.sweep ?? null, directory: false, prune: false };
  }
  if (body.sweep !== undefined) return { error: "sweep goes with a batch" };
  if (
    (body.directory !== undefined && body.directory !== true) ||
    (body.prune !== undefined && body.prune !== true)
  ) {
    return { error: "directory and prune may only be true" };
  }
  if (!body.directory && !body.prune) return { error: "nothing to do" };
  return {
    batch: null,
    sweepId: null,
    directory: body.directory === true,
    prune: body.prune === true,
  };
}

// Compares the x-collector-secret header with the function's secret in constant
// time. A missing or short configured secret refuses everything.
export function isCollectorSecret(given, expected) {
  if (typeof expected !== "string" || expected.length < 32) return false;
  if (typeof given !== "string") return false;
  let difference = given.length ^ expected.length;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= (given.charCodeAt(index) || 0) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

const digitsOrNull = (value, maxLength) => {
  const text = value === null || value === undefined ? "" : String(value).trim();
  return new RegExp(`^[0-9]{1,${maxLength}}$`).test(text) ? text : null;
};
const toIsoOrNull = (entryDate) => parseEntryDate(entryDate)?.toISOString() ?? null;

// The JSDoc types are for the Edge Function, which Deno type-checks against this file.
/**
 * @param {{
 *   db: { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> },
 *   fetch: (url: string, init?: object) => Promise<{ ok: boolean, status: number, text: () => Promise<string> }>,
 *   districtData: any,
 *   stateBoundaries?: any,
 *   archive?: { history?: Function, sweep?: Function, directory?: Function } | null,
 *   runner: "edge" | "laptop",
 *   recordRuns?: boolean,
 *   clock?: () => number,
 *   sleep?: (ms: number) => Promise<unknown>,
 *   log?: (...parts: any[]) => void,
 *   logError?: (...parts: any[]) => void,
 * }} options
 */
export function createCollector({
  db,
  fetch,
  districtData,
  stateBoundaries = null,
  archive = null,
  runner,
  recordRuns = true,
  clock = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
  logError = console.error,
}) {
  const stateNames = new Map(
    districtData.statesWithDistricts.map((state) => [String(state.stateCode), state.stateName]),
  );
  const componentShortNames = new Map(
    districtData.componentList.map((component) => [
      component.componentName.toLowerCase(),
      component.componentShortName,
    ]),
  );
  const nowIso = () => new Date(clock()).toISOString();

  // GET an eRaktKosh endpoint. Returns { ok, data, status, durationMs, bytes, failureKind }.
  async function callEraktkosh(endpoint, params, timeoutMs = TIMEOUT_MS) {
    const started = clock();
    const url = `${BASE_URL}${endpoint}?${new URLSearchParams(params)}`;
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      const durationMs = clock() - started;
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
      return { ok: false, status: null, durationMs: clock() - started, bytes: 0, failureKind };
    }
  }

  // Multi-row INSERT in batches. rows: arrays of values in column order.
  async function insertRows(table, columns, rows, conflictClause, casts = {}) {
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
      await db.query(
        `insert into public.${table} (${columns.join(", ")}) values ${tuples.join(", ")} ${conflictClause}`,
        values,
      );
    }
  }

  async function logCall(endpoint, stateCode, call, rowCount, quality) {
    await db.query(
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

  // Records the start of a job in collector_runs. With guardMinutes, refuses (returns
  // null) when the same job and batch started that recently. The advisory lock makes
  // two calls arriving together take turns, so only one passes.
  /** @param {{ job: string, batch?: number | null, sweepId?: number | null, guardMinutes?: number | null }} options */
  async function startRun({ job, batch = null, sweepId = null, guardMinutes = null }) {
    if (!recordRuns) return { id: null };
    await db.query("begin");
    try {
      if (guardMinutes) {
        await db.query("select pg_advisory_xact_lock(hashtext($1))", [
          `collector_runs:${job}:${batch ?? ""}`,
        ]);
        const { rows } = await db.query(
          `select 1 from public.collector_runs
           where job = $1 and batch is not distinct from $2::smallint
             and started_at > now() - make_interval(mins => $3::integer)
           limit 1`,
          [job, batch, guardMinutes],
        );
        if (rows.length > 0) {
          await db.query("rollback");
          return null;
        }
      }
      const { rows } = await db.query(
        `insert into public.collector_runs (job, batch, sweep_id, runner)
         values ($1, $2, $3, $4) returning id`,
        [job, batch, sweepId, runner],
      );
      await db.query("commit");
      return { id: rows[0].id };
    } catch (error) {
      await db.query("rollback").catch(() => {});
      throw error;
    }
  }

  // Fills in the run's outcome. archiveDay is set only for files in the Storage
  // archive, whose lines the prune counts before deleting a day of history.
  async function finishRun(run, outcome = {}) {
    if (!run?.id) return;
    await db.query(
      `update public.collector_runs set finished_at = now(),
         states_saved = $2, states_failed = $3, states_skipped = $4, rows_changed = $5,
         archive_path = $6, archive_day = $7::date, rows_archived = $8, result = $9::jsonb,
         error = $10
       where id = $1`,
      [
        run.id,
        outcome.statesSaved ?? null,
        outcome.statesFailed ?? null,
        outcome.statesSkipped ?? null,
        outcome.rowsChanged ?? null,
        outcome.archivePath ?? null,
        outcome.archiveDay ?? null,
        outcome.rowsArchived ?? null,
        outcome.result ? JSON.stringify(outcome.result) : null,
        outcome.error ? String(outcome.error).slice(0, 1000) : null,
      ],
    );
  }

  // The nationwide directory, with each bank's location flagged.
  async function collectDirectory() {
    if (!stateBoundaries) throw new Error("the directory run needs stateBoundaries");
    const stateChecker = createStateChecker(stateBoundaries);
    const call = await callEraktkosh("bloodbank/nearest", DIRECTORY_QUERY);
    if (!call.ok) {
      await logCall("bloodbank/nearest", null, call, null, null);
      logError(`directory: failed (${call.failureKind})`);
      return { isSuccess: false, error: `directory: ${call.failureKind}` };
    }
    const pointCounts = new Map();
    const pointKey = (bank) =>
      `${Number(bank.latitude).toFixed(5)},${Number(bank.longitude).toFixed(5)}`;
    for (const bank of call.data)
      pointCounts.set(pointKey(bank), (pointCounts.get(pointKey(bank)) ?? 0) + 1);

    const seenAt = nowIso();
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
    await logCall("bloodbank/nearest", null, call, rows.length, qualityCounts);
    await archive?.directory?.(call.data, seenAt);
    log(`directory: ${rows.length} banks in ${call.durationMs} ms`, qualityCounts);
    const autoRefresh = await collectAutoRefresh();
    const locationFixes = await supersedeLocationFixes();
    return { isSuccess: true, banks: rows.length, qualityCounts, autoRefresh, locationFixes };
  }

  // Once eRaktKosh gives a usable point for a bank that has an unreviewed machine fix
  // (#33, #34; src/lib/bankLocations.js), its point wins and the fix is marked
  // superseded. A new point more than SUPERSEDE_WITHIN_M from the fix is logged for
  // review instead of decided. Before the bank_location_fixes migration is applied
  // this does nothing, and a failure never fails the directory run.
  // Returns { isSuccess, superseded, conflicts } or { isSuccess, skipped | error }.
  async function supersedeLocationFixes() {
    try {
      const { rows: present } = await db.query(
        "select to_regclass('public.bank_location_fixes') is not null as present",
      );
      if (!present[0]?.present) return { isSuccess: true, skipped: "no fixes table" };
      const { rows } = await db.query(
        `select f.hospital_code, f.latitude, f.longitude, b.latitude as eraktkosh_latitude,
           b.longitude as eraktkosh_longitude
         from public.bank_location_fixes f
         join public.blood_banks b using (hospital_code)
         where f.status = 'accepted' and f.reviewed_at is null
           and f.method not in ('manual', 'bank_confirmed')
           and b.latitude is not null
           and (b.location_quality = 'ok' or (b.location_quality = 'shared' and f.reason <> 'shared'))`,
      );
      const near = [];
      const conflicts = [];
      for (const row of rows) {
        const distanceM = haversineMeters(
          { latitude: row.latitude, longitude: row.longitude },
          { latitude: row.eraktkosh_latitude, longitude: row.eraktkosh_longitude },
        );
        if (distanceM <= SUPERSEDE_WITHIN_M) near.push(row.hospital_code);
        else conflicts.push({ hospitalCode: row.hospital_code, distanceM: Math.round(distanceM) });
      }
      if (near.length > 0) {
        await db.query(
          `update public.bank_location_fixes set status = 'superseded'
           where hospital_code = any($1::text[]) and status = 'accepted' and reviewed_at is null`,
          [near],
        );
      }
      if (conflicts.length > 0) {
        logError(
          `location fixes: eRaktKosh now places ${conflicts.length} fixed banks more than ` +
            `${SUPERSEDE_WITHIN_M / 1000} km from their fix; review them on /admin/locations:`,
          conflicts
            .map((c) => `${c.hospitalCode} (${(c.distanceM / 1000).toFixed(1)} km)`)
            .join(", "),
        );
      }
      if (near.length > 0)
        log(`location fixes: ${near.length} superseded by eRaktKosh's own point`);
      return { isSuccess: true, superseded: near.length, conflicts };
    } catch (error) {
      logError(`location fixes: not checked (${error.message})`);
      return { isSuccess: false, error: error.message };
    }
  }

  // Saves blood_banks.auto_refresh from eRaktKosh's auto-refresh list: true for the
  // banks on it, false for the rest. A failed call, or a list with no valid code,
  // keeps the last week's values. Returns { isSuccess, banks } or { isSuccess, error }.
  async function collectAutoRefresh() {
    const call = await callEraktkosh(AUTO_REFRESH_ENDPOINT, {});
    const codes = call.ok
      ? [...new Set(call.data.map((code) => digitsOrNull(code, 10)).filter(Boolean))]
      : [];
    if (!call.ok || codes.length === 0) {
      const failed = call.ok ? { ...call, ok: false, failureKind: "shape" } : call;
      await logCall(AUTO_REFRESH_ENDPOINT, null, failed, call.ok ? 0 : null, null);
      logError(`auto-refresh list: failed (${failed.failureKind}); last values kept`);
      return { isSuccess: false, error: `auto-refresh: ${failed.failureKind}` };
    }
    await db.query(
      `update public.blood_banks set auto_refresh = (hospital_code = any($1::text[]))
       where auto_refresh is distinct from (hospital_code = any($1::text[]))`,
      [codes],
    );
    await logCall(AUTO_REFRESH_ENDPOINT, null, call, codes.length, null);
    log(`auto-refresh list: ${codes.length} banks in ${call.durationMs} ms`);
    return { isSuccess: true, banks: codes.length };
  }

  // Saves each state's stock. A state whose call or save fails is logged and skipped,
  // and the sweep goes on. stopStartingAt and callDeadlineAt (clock times) bound a
  // run that has a time limit: no state starts after the first, and no call waits
  // past the second. States not started are reported as skipped.
  async function collectStates(
    stateCodes,
    { stopStartingAt = Infinity, callDeadlineAt = Infinity } = {},
  ) {
    const { rows: directoryRows } = await db.query(
      "select hospital_code, district_id from public.blood_banks",
    );
    const districtByCode = new Map(
      directoryRows.map((row) => [row.hospital_code, row.district_id]),
    );
    const sweep = { startedAt: nowIso(), states: [] };
    let okCount = 0;
    let failedCount = 0;
    let rowsChanged = 0;
    const skippedCodes = [];

    for (const [index, stateCode] of stateCodes.entries()) {
      if (clock() >= stopStartingAt) {
        skippedCodes.push(...stateCodes.slice(index));
        break;
      }
      if (index > 0) await sleep(STATE_GAP_MS);
      const timeoutMs = Math.max(1_000, Math.min(TIMEOUT_MS, callDeadlineAt - clock()));
      const call = await callEraktkosh("blood-availability", { stateCode }, timeoutMs);
      if (!call.ok) {
        await logCall("blood-availability", stateCode, call, null, null);
        sweep.states.push({
          stateCode,
          ok: false,
          failureKind: call.failureKind,
          ms: call.durationMs,
        });
        failedCount += 1;
        logError(`${stateNames.get(stateCode)}: failed (${call.failureKind})`);
        continue;
      }
      const fetchedAt = nowIso();
      const { rows, report } = validateAvailabilityRows(call.data, { now: new Date(clock()) });
      const { rows: previousRows } = await db.query(
        "select hospital_code, entry_at from public.bank_stock_latest where state_code = $1",
        [stateCode],
      );
      const previousEntry = new Map(
        previousRows.map((row) => [
          row.hospital_code,
          row.entry_at ? new Date(row.entry_at).toISOString() : null,
        ]),
      );

      // Full rows go up only for banks whose update time changed (or that are new);
      // the rest just get a new fetch time. That keeps each upload small.
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

      await db.query("begin");
      try {
        await insertRows(
          "bank_stock_latest",
          ["hospital_code", "state_code", "district_id", "row", "entry_at", "fetched_at"],
          latestRows,
          `on conflict (hospital_code) do update set state_code = excluded.state_code,
             district_id = excluded.district_id, row = excluded.row,
             entry_at = excluded.entry_at, fetched_at = excluded.fetched_at`,
          { row: "::jsonb" },
        );
        if (unchangedCodes.length > 0) {
          await db.query(
            "update public.bank_stock_latest set fetched_at = $1 where hospital_code = any($2::text[])",
            [fetchedAt, unchangedCodes],
          );
        }
        await insertRows(
          "stock_history",
          ["hospital_code", "entry_at", "fetched_at", "state_code", "stock"],
          historyRows,
          "on conflict (hospital_code, entry_at) do nothing",
          { stock: "::jsonb" },
        );
        await logCall("blood-availability", stateCode, call, rows.length, report);
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        // One state's bad row or failed write mustn't stop the rest of the sweep.
        sweep.states.push({ stateCode, ok: false, failureKind: "save", ms: call.durationMs });
        failedCount += 1;
        logError(`${stateNames.get(stateCode)}: save failed (${error.message})`);
        continue;
      }

      await archive?.history?.(
        historyRows.map(([hospitalCode, entryAt, , , stock]) => ({
          v: ARCHIVE_VERSION,
          fetchedAt,
          stateCode,
          hospitalCode,
          entryAt,
          stock: JSON.parse(stock),
        })),
      );
      okCount += 1;
      rowsChanged += historyRows.length;
      sweep.states.push({
        stateCode,
        ok: true,
        ms: call.durationMs,
        bytes: call.bytes,
        rows: rows.length,
        changed: historyRows.length,
        quality: report,
      });
      log(
        `${stateNames.get(stateCode)}: ${rows.length} banks, ${historyRows.length} changed, ${call.durationMs} ms`,
      );
    }

    for (const stateCode of skippedCodes) {
      sweep.states.push({ stateCode, ok: false, failureKind: "skipped" });
    }
    if (skippedCodes.length > 0) {
      logError(
        `skipped, out of time: ${skippedCodes.map((code) => stateNames.get(code)).join(", ")}`,
      );
    }
    sweep.finishedAt = nowIso();
    await archive?.sweep?.(sweep);
    log(`states: ${okCount} of ${stateCodes.length} saved`);
    return {
      isSuccess: okCount > 0 || stateCodes.length === 0,
      statesSaved: okCount,
      statesFailed: failedCount,
      statesSkipped: skippedCodes.length,
      rowsChanged,
      sweep,
    };
  }

  // Trims history past 60 days (only days the Storage archive holds in full) and
  // call logs past 90. Returns the database function's report.
  async function prune() {
    const { rows } = await db.query("select public.prune_stock_store() as result");
    log("pruned:", rows[0].result);
    return rows[0].result;
  }

  return {
    stateNames,
    callEraktkosh,
    compactStock,
    startRun,
    finishRun,
    collectDirectory,
    collectAutoRefresh,
    collectStates,
    prune,
  };
}
