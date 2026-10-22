import axios from "axios";
import { BLOOD_GROUPS, COMPONENTS, findState } from "./constants";

// Server-side client for the public eRaktKosh API.
// - Only whitelisted, validated parameters are forwarded (no open proxy).
// - eRaktKosh parameter names are case-sensitive: stateCode, districtId,
//   componentId, bloodGroupId. Older callers sent districtCode / ComponentId,
//   which eRaktKosh silently ignores, so those are accepted as aliases.
// - Responses are cached briefly; if eRaktKosh fails, the last good response
//   is served and marked stale.

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "https://eraktkosh.mohfw.gov.in/eraktkoshPortal/eraktkosh/";
// Large states are slow: Uttar Pradesh took about 12 s for 1.4 MB when measured.
const TIMEOUT_MS = 25_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 300;
export const MAX_NEAREST_RADIUS_M = 200_000;

const cache = globalThis._bloodlinkEraktkoshCache ?? new Map();
globalThis._bloodlinkEraktkoshCache = cache;

export class UpstreamError extends Error {}

async function cachedGet(path, params) {
  const key = `${path}?${new URLSearchParams(params).toString()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { data: hit.data, stale: false, fetchedAt: hit.at };
  }

  try {
    const response = await axios.get(`${BASE_URL}${path}`, {
      params,
      timeout: TIMEOUT_MS,
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    });
    if (!Array.isArray(response.data)) {
      throw new Error("Unexpected response shape");
    }
    const at = Date.now();
    cache.delete(key);
    cache.set(key, { data: response.data, at });
    if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    return { data: response.data, stale: false, fetchedAt: at };
  } catch (error) {
    if (hit) {
      console.warn(`eRaktKosh ${path} failed (${error.message}); serving cached data`);
      return { data: hit.data, stale: true, fetchedAt: hit.at };
    }
    throw new UpstreamError(`eRaktKosh ${path} failed: ${error.message}`);
  }
}

function firstValue(searchParams, ...names) {
  for (const name of names) {
    const value = searchParams.get(name);
    if (value !== null && value.trim() !== "") return value.trim();
  }
  return null;
}

// componentId and bloodGroupId, shared by region and location search.
export function parseStockFilters(searchParams) {
  const componentId = firstValue(searchParams, "componentId", "ComponentId");
  const bloodGroupId = firstValue(searchParams, "bloodGroupId");

  if (componentId && !COMPONENTS.some((c) => c.code === componentId)) {
    return { error: "Unknown blood component." };
  }
  if (bloodGroupId && !BLOOD_GROUPS.some((g) => g.code === bloodGroupId)) {
    return { error: "Unknown blood group." };
  }

  const filters = {};
  if (componentId) filters.componentId = componentId;
  if (bloodGroupId) filters.bloodGroupId = bloodGroupId;
  return { filters };
}

export function parseAvailabilityQuery(searchParams) {
  const stateCode = firstValue(searchParams, "stateCode");
  const state = stateCode ? findState(stateCode) : null;
  if (!state) return { error: "Select a valid state." };

  const districtId = firstValue(searchParams, "districtId", "districtCode");
  if (districtId && !state.districts.some((d) => String(d.districtCode) === districtId)) {
    return { error: "That district is not in the selected state." };
  }

  const { filters, error } = parseStockFilters(searchParams);
  if (error) return { error };

  const params = { stateCode: String(state.stateCode), ...filters };
  if (districtId) params.districtId = districtId;
  return { params };
}

export function parseCoordinates(searchParams, latName = "latitude", lngName = "longitude") {
  const rawLat = firstValue(searchParams, latName, "lat");
  const rawLng = firstValue(searchParams, lngName, "lng");
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
  const radius = Number(firstValue(searchParams, "radius"));
  if (!Number.isInteger(radius) || radius < 100 || radius > MAX_NEAREST_RADIUS_M) {
    return { error: `Radius must be a whole number of meters between 100 and ${MAX_NEAREST_RADIUS_M}.` };
  }
  return { params: { ...coords, radius } };
}

export function fetchAvailability(params) {
  return cachedGet("blood-availability", params);
}

export function fetchNearest({ latitude, longitude, radius }) {
  return cachedGet("bloodbank/nearest", { latitude, longitude, radius });
}
