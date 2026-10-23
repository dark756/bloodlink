import axios from "axios";
import { BLOOD_GROUPS, COMPONENTS, findState } from "./constants";
import { validateAvailabilityRows } from "./stockQuality";
import { loadSavedAvailability, loadSavedNearest } from "./stockStore";

// Server-side client for the public eRaktKosh API.
// - Only whitelisted, validated parameters are forwarded (no open proxy).
// - eRaktKosh parameter names are case-sensitive: stateCode, districtId,
//   componentId, bloodGroupId. Older callers sent districtCode / ComponentId,
//   which eRaktKosh silently ignores, so those are accepted as aliases.
// - Stock rows are validated by src/lib/stockQuality.js before they are cached.
//
// Each lookup takes the first step that has data:
//   1. memory cache under 5 minutes                          source "cache"
//   2. circuit open: skip eRaktKosh for 2 minutes, then let one request test it.
//      Each state's stock, and nearest, has its own circuit (3 failures within a
//      minute); the whole service is skipped only when failures come from at
//      least two of them                                    -> step 4
//   3. live call, one quick retry on network and 5xx errors; if a backup exists,
//      give up after 8 s and serve it while the call finishes in the background
//                                                            source "live"
//   4. the older copy in memory                              source "memory"
//   5. the copy scripts/snapshot.mjs saved in Supabase       source "saved"
//   6. UpstreamError
// Every answer is { data, source, fetchedAt, stale, upstream } where upstream is
// "ok", "degraded" (slow, served a backup) or "down".

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "https://eraktkosh.mohfw.gov.in/eraktkoshPortal/eraktkosh/";
// Large states are slow: Uttar Pradesh took 12.4 s for 1.4 MB on 2026-10-23.
const TIMEOUT_MS = 25_000;
const BACKUP_GIVE_UP_MS = 8_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 300;
const CIRCUIT = { failures: 3, windowMs: 60_000, openMs: 120_000, serviceMinCircuits: 2 };
const SLOW_SIMULATION_MS = 12_000;
export const MAX_NEAREST_RADIUS_M = 200_000;
export const FAILURE_KINDS = ["timeout", "network", "http", "shape", "circuit"];

export class UpstreamError extends Error {
  constructor(message, kind = "network") {
    super(message);
    this.kind = kind;
  }
}

function classifyError(error) {
  if (error instanceof UpstreamError) return error.kind;
  if (error?.code === "ECONNABORTED" || error?.code === "ETIMEDOUT") return "timeout";
  if (/timeout/i.test(error?.message ?? "")) return "timeout";
  if (error?.response) return "http";
  return "network";
}

const isRetryable = (error) =>
  classifyError(error) === "network" ||
  (classifyError(error) === "http" && error.response.status >= 500);

// http: anything with axios's get(url, config). savedStore: { availability(params),
// nearest(params) } each resolving to { data, fetchedAt } or null. now: a clock in ms.
// simulate: "down", "slow" or "flaky" to rehearse failures; simulateStates: state
// codes whose lookups always fail, to rehearse one state being unreachable.
export function createEraktkoshClient({
  http = axios,
  savedStore = null,
  now = () => Date.now(),
  simulate = null,
  simulateStates = [],
  cache = new Map(),
  timeoutMs = TIMEOUT_MS,
  backupGiveUpMs = BACKUP_GIVE_UP_MS,
  slowSimulationMs = SLOW_SIMULATION_MS,
  retryDelayMs = () => 200 + Math.random() * 300,
} = {}) {
  // One circuit per state's stock lookups and one for nearest, so a single broken
  // state doesn't send every other state to the saved copy. The service circuit
  // opens only when recent failures come from at least two of them, which means
  // eRaktKosh itself is down. recentFailures holds { time, circuitKey }.
  const newCircuit = () => ({ recentFailures: [], openUntil: 0, isProbing: false });
  const service = newCircuit();
  const circuits = new Map();
  const circuitFor = (circuitKey) => {
    if (!circuits.has(circuitKey)) circuits.set(circuitKey, newCircuit());
    return circuits.get(circuitKey);
  };
  // Live calls in progress, by cache key, so concurrent searches share one call.
  const callsInFlight = new Map();

  // "closed"; "open"; or "probe" once the open period is over and no request is
  // testing eRaktKosh yet.
  function circuitState(circuit) {
    if (circuit.openUntil === 0) return "closed";
    return now() < circuit.openUntil || circuit.isProbing ? "open" : "probe";
  }

  // Whether to skip eRaktKosh for this lookup. After an open period, one request
  // may test it.
  function isCircuitOpen(circuitKey) {
    const ownCircuit = circuitFor(circuitKey);
    const [serviceState, ownState] = [circuitState(service), circuitState(ownCircuit)];
    if (serviceState === "open" || ownState === "open") return true;
    if (serviceState === "probe") service.isProbing = true;
    if (ownState === "probe") ownCircuit.isProbing = true;
    return false;
  }

  function closeCircuit(circuit) {
    circuit.recentFailures = [];
    circuit.openUntil = 0;
    circuit.isProbing = false;
  }

  // Any answer shows that eRaktKosh itself is up.
  function recordSuccess(circuitKey) {
    closeCircuit(service);
    closeCircuit(circuitFor(circuitKey));
  }

  function recordFailure(circuitKey) {
    const time = now();
    const isRecent = (failure) => time - failure.time < CIRCUIT.windowMs;
    for (const circuit of [circuitFor(circuitKey), service]) {
      circuit.recentFailures = [...circuit.recentFailures, { time, circuitKey }].filter(isRecent);
      const failingCircuits = new Set(circuit.recentFailures.map((failure) => failure.circuitKey));
      const minCircuits = circuit === service ? CIRCUIT.serviceMinCircuits : 1;
      if (
        circuit.isProbing ||
        (circuit.recentFailures.length >= CIRCUIT.failures && failingCircuits.size >= minCircuits)
      ) {
        circuit.openUntil = time + CIRCUIT.openMs;
      }
      circuit.isProbing = false;
    }
  }

  async function requestOnce(path, params) {
    if (simulate === "down" || (simulate === "flaky" && Math.random() < 0.5)) {
      throw new UpstreamError(`simulated ${simulate} eRaktKosh`, "network");
    }
    if (simulateStates.includes(String(params.stateCode))) {
      throw new UpstreamError(`simulated outage for state ${params.stateCode}`, "network");
    }
    if (simulate === "slow") await new Promise((resolve) => setTimeout(resolve, slowSimulationMs));
    const response = await http.get(`${BASE_URL}${path}`, {
      params,
      timeout: timeoutMs,
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    });
    if (!Array.isArray(response.data))
      throw new UpstreamError("unexpected response shape", "shape");
    return path === "blood-availability"
      ? validateAvailabilityRows(response.data, { now: new Date(now()) }).rows
      : response.data;
  }

  async function requestLive(path, params, circuitKey) {
    try {
      const data = await requestOnce(path, params).catch(async (error) => {
        if (!isRetryable(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs()));
        return requestOnce(path, params);
      });
      recordSuccess(circuitKey);
      return data;
    } catch (error) {
      recordFailure(circuitKey);
      throw new UpstreamError(`eRaktKosh ${path} failed: ${error.message}`, classifyError(error));
    }
  }

  function remember(cacheKey, data) {
    const entry = { data, fetchedAt: now() };
    cache.delete(cacheKey);
    cache.set(cacheKey, entry);
    if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    return entry;
  }

  const answer = (entry, source, upstream) => ({
    data: entry.data,
    fetchedAt: entry.fetchedAt,
    source,
    stale: source === "memory" || source === "saved",
    upstream,
  });

  // Resolves to the saved copy, or null. Never rejects. An empty list is a real
  // answer, for example a state where no bank lists the component asked for.
  async function loadSaved(loader, params) {
    if (!loader) return null;
    try {
      const saved = await loader(params);
      return saved && Array.isArray(saved.data) ? saved : null;
    } catch (error) {
      console.warn(`saved eRaktKosh copy unavailable (${error.message})`);
      return null;
    }
  }

  async function lookup(path, params, savedLoader, giveUpMs = backupGiveUpMs) {
    const cacheKey = `${path}?${new URLSearchParams(params).toString()}`;
    const circuitKey = params.stateCode ? `${path}:${params.stateCode}` : path;
    const cachedEntry = cache.get(cacheKey);
    if (cachedEntry && now() - cachedEntry.fetchedAt < CACHE_TTL_MS) {
      return answer(cachedEntry, "cache", "ok");
    }

    // The older copy in memory, else the saved copy. Without a memory copy the
    // saved one is looked up straight away (one small query per state every
    // 5 minutes at most), so it is ready if the live call is slow or fails.
    let savedPromise = null;
    const backupAnswer = async (upstream) => {
      if (cachedEntry) return answer(cachedEntry, "memory", upstream);
      savedPromise ??= loadSaved(savedLoader, params);
      const saved = await savedPromise;
      return saved ? answer(saved, "saved", upstream) : null;
    };

    if (isCircuitOpen(circuitKey)) {
      const backup = await backupAnswer("down");
      if (backup) return backup;
      throw new UpstreamError(`eRaktKosh ${path} skipped while failing`, "circuit");
    }

    let liveCall = callsInFlight.get(cacheKey);
    if (!liveCall) {
      liveCall = requestLive(path, params, circuitKey)
        .then((data) => remember(cacheKey, data))
        .finally(() => callsInFlight.delete(cacheKey));
      callsInFlight.set(cacheKey, liveCall);
    }
    if (!cachedEntry) savedPromise = loadSaved(savedLoader, params);
    let giveUpTimer;
    const giveUp = new Promise((resolve) => {
      giveUpTimer = setTimeout(() => resolve("give-up"), giveUpMs);
    });

    try {
      const first = await Promise.race([liveCall, giveUp]);
      if (first !== "give-up") return answer(first, "live", "ok");
      const backup = await backupAnswer("degraded");
      if (backup) {
        liveCall.catch(() => {}); // keeps running and refreshes the cache
        return backup;
      }
      return answer(await liveCall, "live", "ok");
    } catch (error) {
      const backup = await backupAnswer("down");
      if (backup) {
        console.warn(`${error.message}; serving the ${backup.source} copy`);
        return backup;
      }
      throw error;
    } finally {
      clearTimeout(giveUpTimer);
    }
  }

  return {
    // options.giveUpMs shortens the wait for a backup, for when eRaktKosh is known to be slow.
    fetchAvailability: (params, options = {}) =>
      lookup("blood-availability", params, savedStore?.availability, options.giveUpMs),
    fetchNearest: ({ latitude, longitude, radius }) =>
      lookup("bloodbank/nearest", { latitude, longitude, radius }, savedStore?.nearest),
  };
}

// ERAKTKOSH_SIMULATE (down, slow or flaky) and ERAKTKOSH_SIMULATE_STATES (state
// codes, comma-separated) rehearse failures. They work in development, or in a
// local production build when ERAKTKOSH_SIMULATE_ALLOW_PRODUCTION=1 is also set
// (for the failure drill). Never set that on a deployed server.
const SIMULATE_MODES = ["down", "slow", "flaky"];
const canSimulate =
  process.env.NODE_ENV !== "production" || process.env.ERAKTKOSH_SIMULATE_ALLOW_PRODUCTION === "1";
const simulateMode =
  canSimulate && SIMULATE_MODES.includes(process.env.ERAKTKOSH_SIMULATE)
    ? process.env.ERAKTKOSH_SIMULATE
    : null;
const simulateStates = canSimulate
  ? (process.env.ERAKTKOSH_SIMULATE_STATES ?? "").split(",").filter((code) => /^\d+$/.test(code))
  : [];

// Kept on globalThis so the cache and circuit survive hot reloads in development.
const defaultClient =
  globalThis._bloodlinkEraktkoshClient ??
  createEraktkoshClient({
    savedStore: { availability: loadSavedAvailability, nearest: loadSavedNearest },
    simulate: simulateMode,
    simulateStates,
  });
globalThis._bloodlinkEraktkoshClient = defaultClient;
if (simulateMode || simulateStates.length > 0) {
  console.warn(`eRaktKosh failures simulated: ${simulateMode ?? "-"}, states ${simulateStates}`);
}

// The first non-empty value among several accepted parameter names.
function getFirstParam(searchParams, ...names) {
  for (const name of names) {
    const value = searchParams.get(name);
    if (value !== null && value.trim() !== "") return value.trim();
  }
  return null;
}

// componentId and bloodGroupId, shared by region and location search.
export function parseStockFilters(searchParams) {
  const componentId = getFirstParam(searchParams, "componentId", "ComponentId");
  const bloodGroupId = getFirstParam(searchParams, "bloodGroupId");

  if (componentId && !COMPONENTS.some((component) => component.code === componentId)) {
    return { error: "Unknown blood component." };
  }
  if (bloodGroupId && !BLOOD_GROUPS.some((group) => group.code === bloodGroupId)) {
    return { error: "Unknown blood group." };
  }

  const filters = {};
  if (componentId) filters.componentId = componentId;
  if (bloodGroupId) filters.bloodGroupId = bloodGroupId;
  return { filters };
}

export function parseAvailabilityQuery(searchParams) {
  const stateCode = getFirstParam(searchParams, "stateCode");
  const state = stateCode ? findState(stateCode) : null;
  if (!state) return { error: "Select a valid state." };

  const districtId = getFirstParam(searchParams, "districtId", "districtCode");
  if (
    districtId &&
    !state.districts.some((district) => String(district.districtCode) === districtId)
  ) {
    return { error: "That district is not in the selected state." };
  }

  const { filters, error } = parseStockFilters(searchParams);
  if (error) return { error };

  const params = { stateCode: String(state.stateCode), ...filters };
  if (districtId) params.districtId = districtId;
  return { params };
}

export function parseCoordinates(searchParams, latName = "latitude", lngName = "longitude") {
  const rawLat = getFirstParam(searchParams, latName, "lat");
  const rawLng = getFirstParam(searchParams, lngName, "lng");
  // Number(null) is 0, so a missing value must be rejected before converting.
  const lat = rawLat === null ? NaN : Number(rawLat);
  const lng = rawLng === null ? NaN : Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { error: "Valid latitude and longitude are required." };
  }
  // 4 decimals is about 11 m, plenty for finding blood banks, and keeps cache keys reusable.
  return { latitude: Number(lat.toFixed(4)), longitude: Number(lng.toFixed(4)) };
}

export function parseNearestQuery(searchParams) {
  const coords = parseCoordinates(searchParams);
  if (coords.error) return coords;
  const radius = Number(getFirstParam(searchParams, "radius"));
  if (!Number.isInteger(radius) || radius < 100 || radius > MAX_NEAREST_RADIUS_M) {
    return {
      error: `Radius must be a whole number of meters between 100 and ${MAX_NEAREST_RADIUS_M}.`,
    };
  }
  return { params: { ...coords, radius } };
}

export function fetchAvailability(params, options) {
  return defaultClient.fetchAvailability(params, options);
}

export function fetchNearest(params) {
  return defaultClient.fetchNearest(params);
}

// One freshness summary for a search that combined several lookups.
// stockAnswers: the stock lookups; failedStateNames: states that could not be
// checked; locationAnswer: the nearest lookup, if any. source and the two ages
// describe the stock only. The saved directory behind nearest is refreshed weekly,
// so its age is reported apart, as locationsFetchedAt, rather than making the
// stock look older than it is. Without stock answers, the location answer is used.
const SOURCE_ORDER = ["live", "cache", "memory", "saved"];
const UPSTREAM_ORDER = ["ok", "degraded", "down"];
export function summarizeFreshness(stockAnswers, failedStateNames = [], { locationAnswer } = {}) {
  const worst = (values, order) =>
    values.reduce((worstSoFar, value) =>
      order.indexOf(value) > order.indexOf(worstSoFar) ? value : worstSoFar,
    );
  const toIso = (time) => (Number.isFinite(time) ? new Date(time).toISOString() : null);
  const ageAnswers =
    stockAnswers.length > 0 ? stockAnswers : [locationAnswer].filter((item) => item);
  const fetchedTimes = ageAnswers.map((item) => item.fetchedAt).filter(Number.isFinite);
  const upstreams = [...stockAnswers, locationAnswer]
    .filter((item) => item)
    .map((item) => item.upstream);
  if (failedStateNames.length > 0) upstreams.push("down");
  return {
    source:
      ageAnswers.length > 0
        ? worst(
            ageAnswers.map((item) => item.source),
            SOURCE_ORDER,
          )
        : null,
    fetchedAt: fetchedTimes.length > 0 ? toIso(Math.max(...fetchedTimes)) : null,
    oldestFetchedAt: fetchedTimes.length > 0 ? toIso(Math.min(...fetchedTimes)) : null,
    upstream: upstreams.length > 0 ? worst(upstreams, UPSTREAM_ORDER) : "ok",
    failedStates: failedStateNames,
    locationsSource: locationAnswer?.source ?? null,
    locationsFetchedAt: toIso(locationAnswer?.fetchedAt),
  };
}
