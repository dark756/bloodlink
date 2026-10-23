import axios from "axios";

// Current rainfall at a point, from Open-Meteo (free for non-commercial use, no key;
// credited on the search page). Used only to slow travel estimates in heavy rain.
// Cached for 15 minutes per 0.1° cell (about 11 km). Failures return null, which
// means "no rain factor".

const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const TIMEOUT_MS = 2_500;
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2_000;

// Kept on globalThis so the cache survives hot reloads in development.
const rainCache = globalThis._bloodlinkRainCache ?? new Map();
globalThis._bloodlinkRainCache = rainCache;

// Open-Meteo "current" JSON -> rain rate in mm per hour, or null.
export function parseRainRate(body) {
  const precipitationMm = body?.current?.precipitation;
  const intervalS = body?.current?.interval;
  if (!Number.isFinite(precipitationMm) || !Number.isFinite(intervalS) || intervalS <= 0) {
    return null;
  }
  return (precipitationMm * 3600) / intervalS;
}

export async function fetchRainMmPerHour({ latitude, longitude }, { http = axios } = {}) {
  const cellLat = Math.round(latitude * 10) / 10;
  const cellLon = Math.round(longitude * 10) / 10;
  const cacheKey = `${cellLat},${cellLon}`;
  const cached = rainCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.rainMmPerHour;

  try {
    const response = await http.get(WEATHER_URL, {
      params: { latitude: cellLat, longitude: cellLon, current: "precipitation" },
      timeout: TIMEOUT_MS,
    });
    const rainMmPerHour = parseRainRate(response.data);
    rainCache.delete(cacheKey);
    rainCache.set(cacheKey, { rainMmPerHour, cachedAt: Date.now() });
    if (rainCache.size > MAX_CACHE_ENTRIES) rainCache.delete(rainCache.keys().next().value);
    return rainMmPerHour;
  } catch (error) {
    console.warn(`Open-Meteo failed (${error.message}); no rain factor`);
    return null;
  }
}
