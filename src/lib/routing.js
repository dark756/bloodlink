import axios from "axios";

// Road distances and free-flow driving times from an OSRM server's table service.
// - OSRM_URL picks the server. The default is the public demo server, whose rules
//   are at most one request a second, a real User-Agent, and OpenStreetMap
//   credit (shown on the search page). Self-host OSRM before real traffic.
// - Results are cached per user-to-bank pair for a day. Roads rarely change, and
//   the time-of-day adjustment is applied afterwards by src/lib/traffic.js.
// - Failures never throw. A failed leg is null, and the caller falls back to a
//   straight-line estimate.

const OSRM_URL = process.env.OSRM_URL || "https://router.project-osrm.org/";
const IS_PUBLIC_SERVER = OSRM_URL.includes("router.project-osrm.org");
const TIMEOUT_MS = 6_000;
const MAX_DESTINATIONS_PER_CALL = 250;
const PUBLIC_SERVER_GAP_MS = 1_000;
// Rather than queue a search behind many others, give up and estimate.
const MAX_QUEUE_WAIT_MS = 3_000;
const CACHE_TTL_MS = 24 * 3_600_000;
const MAX_CACHE_ENTRIES = 20_000;
const USER_AGENT = "bloodLink/0.1 (B.Tech project, blood bank search)";

// Kept on globalThis so the cache and the request spacing survive hot reloads.
const legCache = globalThis._bloodlinkRouteCache ?? new Map();
globalThis._bloodlinkRouteCache = legCache;
const requestClock = globalThis._bloodlinkOsrmClock ?? { nextSlotAt: 0 };
globalThis._bloodlinkOsrmClock = requestClock;

// OSRM wants "longitude,latitude". 5 decimals is about 1 m.
const pointKey = ({ latitude, longitude }) =>
  `${Number(longitude).toFixed(5)},${Number(latitude).toFixed(5)}`;

const hasValidPoint = ({ latitude, longitude }) =>
  Number.isFinite(Number(latitude)) &&
  Number.isFinite(Number(longitude)) &&
  !(Number(latitude) === 0 && Number(longitude) === 0);

// Reserve the next request slot, or throw if the wait would be too long.
async function waitForSlot(minGapMs) {
  if (minGapMs <= 0) return;
  const now = Date.now();
  const slotAt = Math.max(now, requestClock.nextSlotAt);
  if (slotAt - now > MAX_QUEUE_WAIT_MS) throw new Error("too many routing requests queued");
  requestClock.nextSlotAt = slotAt + minGapMs;
  if (slotAt > now) await new Promise((resolve) => setTimeout(resolve, slotAt - now));
}

// OSRM table JSON (one source, then the destinations) -> one leg per destination,
// { distanceM, durationS }, or null where OSRM found no route.
export function parseTable(body, destinationCount) {
  if (body?.code !== "Ok") throw new Error(`OSRM answered ${body?.code ?? "nothing"}`);
  const durations = body.durations?.[0];
  const distances = body.distances?.[0];
  if (
    !Array.isArray(durations) ||
    !Array.isArray(distances) ||
    durations.length !== destinationCount + 1 ||
    distances.length !== destinationCount + 1
  ) {
    throw new Error("Unexpected OSRM table shape");
  }
  // Index 0 is the source itself.
  return Array.from({ length: destinationCount }, (_, index) => {
    const durationS = durations[index + 1];
    const distanceM = distances[index + 1];
    return Number.isFinite(durationS) && Number.isFinite(distanceM)
      ? { distanceM, durationS }
      : null;
  });
}

function cacheLeg(key, leg) {
  legCache.delete(key);
  legCache.set(key, { leg, cachedAt: Date.now() });
  if (legCache.size > MAX_CACHE_ENTRIES) legCache.delete(legCache.keys().next().value);
}

// origin and destinations: { latitude, longitude }. Returns { legs, failed }, with
// legs in the same order as destinations; failed is true if any OSRM call failed.
export async function fetchRoadLegs(
  origin,
  destinations,
  { http = axios, minGapMs = IS_PUBLIC_SERVER ? PUBLIC_SERVER_GAP_MS : 0 } = {},
) {
  const originKey = pointKey(origin);
  const legs = destinations.map((destination) => {
    if (!hasValidPoint(destination)) return null;
    const cached = legCache.get(`${originKey}|${pointKey(destination)}`);
    return cached && Date.now() - cached.cachedAt < CACHE_TTL_MS ? cached.leg : undefined;
  });
  const missingIndexes = legs.flatMap((leg, index) => (leg === undefined ? [index] : []));
  let failed = false;

  for (let start = 0; start < missingIndexes.length; start += MAX_DESTINATIONS_PER_CALL) {
    const chunk = missingIndexes.slice(start, start + MAX_DESTINATIONS_PER_CALL);
    try {
      await waitForSlot(minGapMs);
      const coordinates = [origin, ...chunk.map((index) => destinations[index])]
        .map(pointKey)
        .join(";");
      const response = await http.get(`${OSRM_URL}table/v1/driving/${coordinates}`, {
        params: { sources: 0, annotations: "duration,distance" },
        timeout: TIMEOUT_MS,
        headers: { "User-Agent": USER_AGENT },
      });
      const chunkLegs = parseTable(response.data, chunk.length);
      chunk.forEach((destinationIndex, chunkIndex) => {
        legs[destinationIndex] = chunkLegs[chunkIndex];
        cacheLeg(`${originKey}|${pointKey(destinations[destinationIndex])}`, chunkLegs[chunkIndex]);
      });
    } catch (error) {
      failed = true;
      console.warn(`OSRM table failed (${error.message}); using straight-line estimates`);
      for (const destinationIndex of chunk) legs[destinationIndex] = null;
    }
  }
  return { legs, failed };
}
