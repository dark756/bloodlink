// Distance helpers. Pure, safe on client and server and in the Node scripts.

const EARTH_RADIUS_M = 6_371_000;
const toRadians = (degrees) => (degrees * Math.PI) / 180;

// Great-circle (straight-line) distance in meters between two { latitude, longitude } points.
export function haversineMeters(from, to) {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Mainland India and its islands, with a little margin. Coordinates outside
// this box are data errors (two banks sat in the Arabian Sea on 2026-10-23).
export const INDIA_BOUNDS = { minLat: 6, maxLat: 37.5, minLon: 68, maxLon: 97.5 };

export function isInIndia({ latitude, longitude }) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= INDIA_BOUNDS.minLat &&
    latitude <= INDIA_BOUNDS.maxLat &&
    longitude >= INDIA_BOUNDS.minLon &&
    longitude <= INDIA_BOUNDS.maxLon
  );
}
