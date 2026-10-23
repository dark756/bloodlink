// Builds assets/state_boundaries.json: one outline per state and union territory,
// keyed by eRaktKosh state code, for checking that a bank's coordinates fall in its
// own state (src/lib/stateBounds.js).
//
//   node scripts/build-state-boundaries.mjs
//
// Source: geoBoundaries IND ADM1 (DataMeet India community and the Election
// Commission of India), licensed CC BY 2.5 IN, which must be credited. Its 36
// outlines match eRaktKosh's 36 states by name. Outlines are simplified to about
// 1 km and rounded to 3 decimals; the check allows a 5 km margin, so neither
// changes its answer. Run it again only if state boundaries change.

import fs from "node:fs";

const SOURCE_URL =
  "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IND/ADM1/geoBoundaries-IND-ADM1_simplified.geojson";
const OUTPUT_PATH = new URL("../assets/state_boundaries.json", import.meta.url);
const DISTRICT_DATA_PATH = new URL("../assets/district_data.json", import.meta.url);
const TOLERANCE_DEGREES = 0.01; // about 1.1 km
const round3 = (value) => Math.round(value * 1000) / 1000;

// "Tamil Nādu" and "Dadra And Nagar Haveli And Daman And Diu" -> "tamil nadu", ...
const normalizeName = (name) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z]+/g, " ")
    .trim();

// Distance from point p to the line through a and b, in degrees.
function distanceToLine([x, y], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(x - ax, y - ay);
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

// Douglas-Peucker, without recursion. A ring too small to survive keeps its
// bounding box, so small islands are still covered.
function simplifyRing(ring) {
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop();
    let farthestIndex = -1;
    let farthestDistance = TOLERANCE_DEGREES;
    for (let index = start + 1; index < end; index += 1) {
      const distance = distanceToLine(ring[index], ring[start], ring[end]);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthestIndex = index;
      }
    }
    if (farthestIndex !== -1) {
      keep[farthestIndex] = 1;
      stack.push([start, farthestIndex], [farthestIndex, end]);
    }
  }
  const simplified = ring.filter((_, index) => keep[index]);
  if (simplified.length >= 4) return simplified.map(([lon, lat]) => [round3(lon), round3(lat)]);
  const lons = ring.map(([lon]) => lon);
  const lats = ring.map(([, lat]) => lat);
  const [west, east] = [Math.min(...lons), Math.max(...lons)].map(round3);
  const [south, north] = [Math.min(...lats), Math.max(...lats)].map(round3);
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

const districtData = JSON.parse(fs.readFileSync(DISTRICT_DATA_PATH, "utf8"));
const stateCodesByName = new Map(
  districtData.statesWithDistricts.map((state) => [
    normalizeName(state.stateName),
    String(state.stateCode),
  ]),
);

const response = await fetch(SOURCE_URL);
if (!response.ok) throw new Error(`geoBoundaries: HTTP ${response.status}`);
const geojson = await response.json();

const states = {};
let pointCount = 0;
for (const feature of geojson.features) {
  const name = feature.properties.shapeName;
  const stateCode = stateCodesByName.get(normalizeName(name));
  if (!stateCode) throw new Error(`no eRaktKosh state matches "${name}"`);
  const polygons =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  const simplified = polygons.map((polygon) => polygon.map(simplifyRing));
  const points = simplified.flat(2);
  pointCount += points.length;
  states[stateCode] = {
    name: name.normalize("NFD").replace(/[̀-ͯ]/g, ""),
    // [west, south, east, north]
    bbox: [
      Math.min(...points.map(([lon]) => lon)),
      Math.min(...points.map(([, lat]) => lat)),
      Math.max(...points.map(([lon]) => lon)),
      Math.max(...points.map(([, lat]) => lat)),
    ],
    polygons: simplified,
  };
}
const missing = [...stateCodesByName.values()].filter((stateCode) => !states[stateCode]);
if (missing.length > 0) throw new Error(`no outline for state codes ${missing.join(", ")}`);

const boundaries = {
  source:
    "geoBoundaries IND ADM1 (DataMeet India community, Election Commission of India), https://www.geoboundaries.org",
  license: "CC BY 2.5 IN",
  retrievedOn: new Date().toISOString().slice(0, 10),
  notes: [
    "states[eRaktKosh state code] = { name, bbox: [west, south, east, north], polygons }",
    "polygons: GeoJSON MultiPolygon coordinates ([longitude, latitude]), simplified to about 1 km",
  ],
  states,
};
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(boundaries) + "\n");
console.log(
  `Wrote ${Object.keys(states).length} states, ${pointCount} points, ` +
    `${Math.round(fs.statSync(OUTPUT_PATH).size / 1024)} KB to ${OUTPUT_PATH.pathname}`,
);
