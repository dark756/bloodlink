import axios from "axios";

// Place names for a map pin, from OpenStreetMap's Nominatim, asked by the server.
// - The browser never contacts Nominatim, so the pin reaches it rounded to 3 decimals
//   (about 110 m, src/lib/geo.js), and the app's total traffic stays within
//   Nominatim's usage policy: at most one request a second, a real User-Agent, and
//   OpenStreetMap credit (on the map).
// - Names are cached per rounded point for a week. Places rarely change.
// - Failures never throw. The name is null, and the page shows the coordinates.

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const TIMEOUT_MS = 5_000;
const REQUEST_GAP_MS = 1_000;
// Rather than queue a lookup behind many others, give up and show the coordinates.
const MAX_QUEUE_WAIT_MS = 3_000;
const CACHE_TTL_MS = 7 * 24 * 3_600_000;
const MAX_CACHE_ENTRIES = 5_000;
const USER_AGENT =
  "bloodLink/0.1 (B.Tech project, blood bank search; https://github.com/dark756/bloodlink)";

// Kept on globalThis so the cache and the request spacing survive hot reloads.
const placeCache = globalThis._bloodlinkPlaceCache ?? new Map();
globalThis._bloodlinkPlaceCache = placeCache;
const requestClock = globalThis._bloodlinkNominatimClock ?? { nextSlotAt: 0 };
globalThis._bloodlinkNominatimClock = requestClock;

// Nominatim reverse JSON -> a short place name, such as the city or village, or null.
export function parsePlaceLabel(body) {
  const address = body?.address ?? {};
  return (
    address.city ||
    address.city_district ||
    address.town ||
    address.village ||
    address.county ||
    address.state ||
    body?.display_name?.split(",")[0] ||
    null
  );
}

// Reserve the next request slot, or throw if the wait would be too long.
async function waitForSlot(minGapMs) {
  if (minGapMs <= 0) return;
  const now = Date.now();
  const slotAt = Math.max(now, requestClock.nextSlotAt);
  if (slotAt - now > MAX_QUEUE_WAIT_MS) throw new Error("too many place lookups queued");
  requestClock.nextSlotAt = slotAt + minGapMs;
  if (slotAt > now) await new Promise((resolve) => setTimeout(resolve, slotAt - now));
}

// { latitude, longitude }, already rounded by parseCoordinates -> a place name or null.
export async function reverseGeocode(
  { latitude, longitude },
  { http = axios, minGapMs = REQUEST_GAP_MS } = {},
) {
  const cacheKey = `${latitude},${longitude}`;
  const cached = placeCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.label;

  try {
    await waitForSlot(minGapMs);
    const response = await http.get(NOMINATIM_URL, {
      params: { format: "json", lat: latitude, lon: longitude },
      timeout: TIMEOUT_MS,
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
    });
    const label = parsePlaceLabel(response.data);
    placeCache.delete(cacheKey);
    placeCache.set(cacheKey, { label, cachedAt: Date.now() });
    if (placeCache.size > MAX_CACHE_ENTRIES) placeCache.delete(placeCache.keys().next().value);
    return label;
  } catch (error) {
    console.warn(`Nominatim failed (${error.message}); no place name`);
    return null;
  }
}
