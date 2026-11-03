import { createClient } from "@supabase/supabase-js";
import { findState, getComponentName } from "./constants";
import { haversineMeters } from "./geo";
import { districtFromAddress, keepOnlyComponent } from "./stock";

// Reads the eRaktKosh copy that scripts/snapshot.mjs saves in Supabase. It is
// public data, so it is read with the publishable key and no user session.
// src/lib/eraktkosh.js uses it only when eRaktKosh is slow or down. Both
// loaders resolve to { data, fetchedAt } in eRaktKosh's own shapes, or null.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const PAGE_SIZE = 1000; // the Data API's default row limit
const DIRECTORY_TTL_MS = 60 * 60 * 1000;
// The collector saves stock hourly at most, so a state's rows are downloaded once
// per 10 minutes and shared by every component, group and district lookup.
const STATE_ROWS_TTL_MS = 10 * 60 * 1000;

let publicClient = null;
function getPublicClient() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  publicClient ??= createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return publicClient;
}

// Every row of a query, a page at a time.
async function selectAllRows(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

// Kept on globalThis so the cache survives hot reloads in development.
// stateCode -> { rowsPromise, loadedAt }. The promise is cached, so lookups made
// while a download is under way share it.
const stateRowsCache = globalThis._bloodlinkSavedStock ?? new Map();
globalThis._bloodlinkSavedStock = stateRowsCache;

// A state's saved rows as [{ row, districtId, fetchedAt }]. The district comes from
// the directory when the bank is in it, else from the address: the banks without
// coordinates have no directory row, and eRaktKosh's stock rows carry no district.
function loadStateRows(supabase, stateCode) {
  const now = Date.now();
  for (const [cachedCode, entry] of stateRowsCache) {
    if (now - entry.loadedAt >= STATE_ROWS_TTL_MS) stateRowsCache.delete(cachedCode);
  }
  const cached = stateRowsCache.get(stateCode);
  if (cached) return cached.rowsPromise;

  const state = findState(stateCode);
  const rowsPromise = selectAllRows(() =>
    supabase
      .from("bank_stock_latest")
      .select("row, district_id, fetched_at")
      .eq("state_code", stateCode)
      .order("hospital_code"),
  ).then((savedRows) =>
    savedRows.map((savedRow) => ({
      row: savedRow.row,
      districtId:
        savedRow.district_id ??
        districtFromAddress(savedRow.row?.hospitaladd, state?.stateName, state?.districts ?? []),
      fetchedAt: Date.parse(savedRow.fetched_at),
    })),
  );
  stateRowsCache.set(stateCode, { rowsPromise, loadedAt: now });
  // A failed download isn't kept, so the next lookup tries again.
  rowsPromise.catch(() => {
    if (stateRowsCache.get(stateCode)?.rowsPromise === rowsPromise)
      stateRowsCache.delete(stateCode);
  });
  return rowsPromise;
}

// { stateCode, districtId, componentId } -> the saved rows for that state or
// district. The collector saves every component, so with a componentId the rows
// are cut down to that component, as a live filtered answer would be.
// fetchedAt is the oldest row's fetch time, so the age shown is never flattering.
export async function loadSavedAvailability({ stateCode, districtId, componentId }) {
  const supabase = getPublicClient();
  if (!supabase) return null;
  const stateRows = await loadStateRows(supabase, String(stateCode));
  const rows = districtId
    ? stateRows.filter((savedRow) => savedRow.districtId === String(districtId))
    : stateRows;
  if (rows.length === 0) return null;
  const savedRows = rows.map((savedRow) => savedRow.row);
  const componentName = componentId ? getComponentName(componentId) : null;
  return {
    data: componentName ? keepOnlyComponent(savedRows, componentName) : savedRows,
    fetchedAt: Math.min(...rows.map((savedRow) => savedRow.fetchedAt)),
  };
}

// Kept on globalThis so the directory survives hot reloads in development.
const directoryCache = globalThis._bloodlinkDirectory ?? { banks: null, loadedAt: 0 };
globalThis._bloodlinkDirectory = directoryCache;

// Banks flagged wrong_state or outside_india are kept, as eRaktKosh's own answer
// keeps them: /api/blood-search leaves them out and counts them as misplaced, so
// the count stays right while the saved copy is in use.
async function loadDirectory(supabase) {
  if (directoryCache.banks && Date.now() - directoryCache.loadedAt < DIRECTORY_TTL_MS) {
    return directoryCache.banks;
  }
  const banks = await selectAllRows(() =>
    supabase
      .from("blood_banks")
      .select(
        "hospital_code, name, address, phone, state_code, district_id, latitude, longitude, bank_type, hospital_type, stock_source, last_seen_at",
      )
      .not("latitude", "is", null)
      .order("hospital_code"),
  );
  directoryCache.banks = banks;
  directoryCache.loadedAt = Date.now();
  return banks;
}

// { latitude, longitude, radius } -> saved directory banks within the radius, in
// eRaktKosh's "nearest" shape with straight-line distances. About 4,300 rows,
// so a scan in memory takes a few milliseconds.
export async function loadSavedNearest({ latitude, longitude, radius }) {
  const supabase = getPublicClient();
  if (!supabase) return null;
  const banks = await loadDirectory(supabase);
  if (banks.length === 0) return null;
  const origin = { latitude, longitude };
  const data = banks
    .map((bank) => ({
      hospitalCode: Number(bank.hospital_code),
      name: bank.name,
      address: bank.address,
      phone: bank.phone,
      latitude: bank.latitude,
      longitude: bank.longitude,
      stateCode: Number(bank.state_code),
      distId: bank.district_id === null ? null : Number(bank.district_id),
      type: bank.bank_type,
      hospitalType: bank.hospital_type,
      stockSource: bank.stock_source,
      dist: haversineMeters(origin, bank),
    }))
    .filter((bank) => bank.dist <= radius)
    .sort((a, b) => a.dist - b.dist);
  return { data, fetchedAt: Math.max(...banks.map((bank) => Date.parse(bank.last_seen_at))) };
}
