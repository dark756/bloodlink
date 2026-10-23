import { isInIndia } from "./geo.js";

// Checks that a bank's coordinates fall in its own state. eRaktKosh's nearest call
// places some banks hundreds of km away: on 2026-10-24, banks from Punjab, Kerala,
// Tamil Nadu and Assam sat in central Delhi. Location search leaves such banks out,
// and scripts/snapshot.mjs flags them in blood_banks.location_quality.
//
// boundaries is assets/state_boundaries.json (scripts/build-state-boundaries.mjs):
// simplified state outlines keyed by eRaktKosh state code. A point counts as in
// its state when it is inside the outline or within STATE_MARGIN_KM of it, which
// absorbs the simplification and small position errors at borders. The file is
// passed in rather than imported, so the Node scripts can use this module too.

export const STATE_MARGIN_KM = 5;
const KM_PER_DEGREE_LAT = 110.57;
const KM_PER_DEGREE_LON_AT_EQUATOR = 111.32;
const MAX_CACHE_ENTRIES = 10_000;

// Ray casting: whether [lon, lat] lies inside one ring.
function isInsideRing(lon, lat, ring) {
  let isInside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[previous];
    if (y1 > lat !== y2 > lat && lon < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) {
      isInside = !isInside;
    }
  }
  return isInside;
}

// A polygon is its outer ring minus any holes.
const isInsidePolygon = (lon, lat, [outerRing, ...holes]) =>
  isInsideRing(lon, lat, outerRing) && !holes.some((hole) => isInsideRing(lon, lat, hole));

// Shortest distance in km from the point to a ring's edges, on a flat projection
// centred on the point, which is accurate enough over a few km.
function distanceToRingKm(lon, lat, ring) {
  const kmPerDegreeLon = KM_PER_DEGREE_LON_AT_EQUATOR * Math.cos((lat * Math.PI) / 180);
  const toKm = ([pointLon, pointLat]) => [
    (pointLon - lon) * kmPerDegreeLon,
    (pointLat - lat) * KM_PER_DEGREE_LAT,
  ];
  let shortest = Infinity;
  for (let index = 1; index < ring.length; index += 1) {
    const [ax, ay] = toKm(ring[index - 1]);
    const [bx, by] = toKm(ring[index]);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
    shortest = Math.min(shortest, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return shortest;
}

export function createStateChecker(boundaries, { marginKm = STATE_MARGIN_KM } = {}) {
  const problemCache = new Map();

  // km from the point to its state's outline: 0 inside it, null when the state has
  // no outline.
  function distanceOutsideStateKm({ latitude, longitude }, stateCode) {
    const state = boundaries.states[String(stateCode)];
    if (!state) return null;
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (state.polygons.some((polygon) => isInsidePolygon(lon, lat, polygon))) return 0;
    return Math.min(
      ...state.polygons.flatMap((polygon) =>
        polygon.map((ring) => distanceToRingKm(lon, lat, ring)),
      ),
    );
  }

  // Whether the point is outside its state's bounding box by more than the margin,
  // which settles most far-off points without measuring.
  function isFarOutsideBox({ latitude, longitude }, stateCode) {
    const state = boundaries.states[String(stateCode)];
    if (!state) return false;
    const [west, south, east, north] = state.bbox;
    const latMargin = marginKm / KM_PER_DEGREE_LAT;
    const lonMargin =
      marginKm / (KM_PER_DEGREE_LON_AT_EQUATOR * Math.cos((Number(latitude) * Math.PI) / 180));
    return (
      latitude < south - latMargin ||
      latitude > north + latMargin ||
      longitude < west - lonMargin ||
      longitude > east + lonMargin
    );
  }

  // Why a bank's position can't be used for distances, or null when it can:
  // "missing", "outside_india" or "wrong_state". bank: { latitude, longitude, stateCode }.
  function locationProblem({ latitude, longitude, stateCode }) {
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (latitude === null || longitude === null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return "missing";
    }
    if (lat === 0 && lon === 0) return "missing";
    if (!isInIndia({ latitude: lat, longitude: lon })) return "outside_india";

    const cacheKey = `${stateCode}|${lat}|${lon}`;
    if (problemCache.has(cacheKey)) return problemCache.get(cacheKey);
    const point = { latitude: lat, longitude: lon };
    const isWrongState =
      isFarOutsideBox(point, stateCode) ||
      (distanceOutsideStateKm(point, stateCode) ?? 0) > marginKm;
    const problem = isWrongState ? "wrong_state" : null;
    problemCache.set(cacheKey, problem);
    if (problemCache.size > MAX_CACHE_ENTRIES)
      problemCache.delete(problemCache.keys().next().value);
    return problem;
  }

  return { distanceOutsideStateKm, locationProblem };
}
