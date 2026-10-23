// Geospatial search benchmark (the reviewer's point 2 in report 3).
//
//   node scripts/benchmark-geo.mjs <nearest directory json> [--sizes 4328,10000,...] [--queries 200]
//                                  [--postgis] [--skip-memory] [--out file]
//
// Task: every bank within a radius of a point, sorted by distance, at 15 km (the
// density check) and 150 km (the widest search). Methods, all in memory:
//   linear  Haversine against every bank
//   rings   the app's ring search over a linear scan (the saved-directory fallback)
//   grid    0.25° buckets, then Haversine on the buckets the radius touches
//   kdtree  a k-d tree on 3-D unit vectors (exact for great-circle radii)
//   rtree   a packed (STR) R-tree on longitude and latitude boxes
// and, with --postgis, PostGIS ST_DWithin on a GiST index in Supabase, timed
// with EXPLAIN ANALYZE so the network round trip to Tokyo is left out.
// Datasets: the real directory, then copies of it with ~5 km of random jitter,
// which keeps the real clustering of banks. Every method must return exactly the
// banks the linear scan returns; the script stops if one doesn't.

import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { haversineMeters } from "../src/lib/geo.js";

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const directoryFile = args[0];
const sizes = argValue("--sizes", "4328,10000,50000,100000,500000").split(",").map(Number);
const queryCount = Number(argValue("--queries", "200"));
const usePostgis = args.includes("--postgis");
const skipMemory = args.includes("--skip-memory");
const outFile = argValue("--out", null);
const RADII_M = [15_000, 150_000];
const EARTH_RADIUS_M = 6_371_000;
const RINGS_M = {
  urban: [5_000, 10_000, 15_000, 25_000],
  rural: [20_000, 50_000, 100_000, 150_000],
};

// Small seeded random generator, so every run uses the same synthetic data.
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const realBanks = JSON.parse(fs.readFileSync(directoryFile, "utf8"))
  .map((bank) => ({
    id: String(bank.hospitalCode),
    latitude: Number(bank.latitude),
    longitude: Number(bank.longitude),
  }))
  .filter(
    (bank) =>
      bank.latitude > 6 && bank.latitude < 37.5 && bank.longitude > 68 && bank.longitude < 97.5,
  );

function makeDataset(size) {
  if (size <= realBanks.length) return realBanks.slice(0, size);
  const random = makeRandom(size);
  return Array.from({ length: size }, (_, index) => {
    const base = realBanks[index % realBanks.length];
    if (index < realBanks.length) return base;
    return {
      id: `${base.id}-${index}`,
      latitude: base.latitude + (random() - 0.5) * 0.1,
      longitude: base.longitude + (random() - 0.5) * 0.1,
    };
  });
}

function makeQueries() {
  const random = makeRandom(7);
  return Array.from({ length: queryCount }, () => {
    const base = realBanks[Math.floor(random() * realBanks.length)];
    return {
      latitude: base.latitude + (random() - 0.5) * 0.04,
      longitude: base.longitude + (random() - 0.5) * 0.04,
    };
  });
}

// ── methods ──────────────────────────────────────────────────────────────────

function linearSearch(points, query, radiusM, counter) {
  const found = [];
  for (const point of points) {
    counter.candidates += 1;
    const distance = haversineMeters(query, point);
    if (distance <= radiusM) found.push({ id: point.id, distance });
  }
  return found.sort((a, b) => a.distance - b.distance);
}

// The app's logic: count banks within 15 km to pick the ring set, then return
// the smallest ring with at least one bank (the radius stays the caller's cap).
function ringSearch(points, query, radiusM, counter) {
  const all = linearSearch(points, query, Math.max(radiusM, 150_000), counter);
  const dense = all.filter((bank) => bank.distance <= 15_000).length > 10;
  const rings = (dense ? RINGS_M.urban : RINGS_M.rural).filter((ring) => ring <= radiusM);
  const ring = rings.find((ringM) => all.some((bank) => bank.distance <= ringM)) ?? radiusM;
  return { banks: all.filter((bank) => bank.distance <= radiusM), ring };
}

function buildGrid(points, cellDegrees = 0.25) {
  const cells = new Map();
  for (const point of points) {
    const key = `${Math.floor(point.latitude / cellDegrees)}:${Math.floor(point.longitude / cellDegrees)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(point);
  }
  return { cells, cellDegrees };
}

// Degrees of latitude and longitude a radius can reach. The longitude span uses
// the circle's edge nearest the pole, where a degree of longitude is shortest,
// with a little slack, so the box always contains the whole circle.
const METERS_PER_DEGREE = (EARTH_RADIUS_M * Math.PI) / 180;
function searchSpans(query, radiusM) {
  const latSpan = (radiusM / METERS_PER_DEGREE) * 1.001;
  const edgeLatitude = Math.min(89, Math.abs(query.latitude) + latSpan);
  const lonSpan =
    (radiusM / (METERS_PER_DEGREE * Math.cos((edgeLatitude * Math.PI) / 180))) * 1.001;
  return { latSpan, lonSpan };
}

function gridSearch({ cells, cellDegrees }, query, radiusM, counter) {
  const { latSpan, lonSpan } = searchSpans(query, radiusM);
  const found = [];
  for (
    let row = Math.floor((query.latitude - latSpan) / cellDegrees);
    row <= Math.floor((query.latitude + latSpan) / cellDegrees);
    row += 1
  ) {
    for (
      let col = Math.floor((query.longitude - lonSpan) / cellDegrees);
      col <= Math.floor((query.longitude + lonSpan) / cellDegrees);
      col += 1
    ) {
      for (const point of cells.get(`${row}:${col}`) ?? []) {
        counter.candidates += 1;
        const distance = haversineMeters(query, point);
        if (distance <= radiusM) found.push({ id: point.id, distance });
      }
    }
  }
  return found.sort((a, b) => a.distance - b.distance);
}

const toUnitVector = ({ latitude, longitude }) => {
  const lat = (latitude * Math.PI) / 180;
  const lon = (longitude * Math.PI) / 180;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
};

function buildKdTree(points) {
  const items = points.map((point) => ({ point, vector: toUnitVector(point) }));
  const build = (list, depth) => {
    if (list.length === 0) return null;
    const axis = depth % 3;
    list.sort((a, b) => a.vector[axis] - b.vector[axis]);
    const middle = list.length >> 1;
    return {
      item: list[middle],
      axis,
      left: build(list.slice(0, middle), depth + 1),
      right: build(list.slice(middle + 1), depth + 1),
    };
  };
  return build(items, 0);
}

function kdSearch(tree, query, radiusM, counter) {
  const target = toUnitVector(query);
  // A slightly loose chord test, then the same Haversine check as every other
  // method, so floating-point rounding at the edge can't change the answer.
  const chord = 2 * Math.sin(radiusM / (2 * EARTH_RADIUS_M)) * (1 + 1e-9);
  const chordSquared = chord * chord;
  const found = [];
  const visit = (node) => {
    if (!node) return;
    counter.candidates += 1;
    const v = node.item.vector;
    const squared = (v[0] - target[0]) ** 2 + (v[1] - target[1]) ** 2 + (v[2] - target[2]) ** 2;
    if (squared <= chordSquared) {
      const distance = haversineMeters(query, node.item.point);
      if (distance <= radiusM) found.push({ id: node.item.point.id, distance });
    }
    const delta = target[node.axis] - v[node.axis];
    visit(delta <= 0 ? node.left : node.right);
    if (delta * delta <= chordSquared) visit(delta <= 0 ? node.right : node.left);
  };
  visit(tree);
  return found.sort((a, b) => a.distance - b.distance);
}

// Packed R-tree (Sort-Tile-Recursive), 16 entries per node.
function buildRTree(points, nodeSize = 16) {
  let level = points.map((point) => ({
    minX: point.longitude,
    minY: point.latitude,
    maxX: point.longitude,
    maxY: point.latitude,
    point,
  }));
  const pack = (entries) => {
    const sliceCount = Math.ceil(Math.sqrt(Math.ceil(entries.length / nodeSize)));
    const sliceSize = sliceCount * nodeSize;
    const sorted = [...entries].sort((a, b) => a.minX + a.maxX - (b.minX + b.maxX));
    const nodes = [];
    for (let start = 0; start < sorted.length; start += sliceSize) {
      const slice = sorted
        .slice(start, start + sliceSize)
        .sort((a, b) => a.minY + a.maxY - (b.minY + b.maxY));
      for (let index = 0; index < slice.length; index += nodeSize) {
        const children = slice.slice(index, index + nodeSize);
        nodes.push({
          minX: Math.min(...children.map((child) => child.minX)),
          minY: Math.min(...children.map((child) => child.minY)),
          maxX: Math.max(...children.map((child) => child.maxX)),
          maxY: Math.max(...children.map((child) => child.maxY)),
          children,
        });
      }
    }
    return nodes;
  };
  while (level.length > nodeSize) level = pack(level);
  return { minX: -180, minY: -90, maxX: 180, maxY: 90, children: level };
}

function rtreeSearch(root, query, radiusM, counter) {
  const { latSpan, lonSpan } = searchSpans(query, radiusM);
  const box = {
    minX: query.longitude - lonSpan,
    maxX: query.longitude + lonSpan,
    minY: query.latitude - latSpan,
    maxY: query.latitude + latSpan,
  };
  const found = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    for (const child of node.children) {
      if (
        child.maxX < box.minX ||
        child.minX > box.maxX ||
        child.maxY < box.minY ||
        child.minY > box.maxY
      )
        continue;
      if (child.point) {
        counter.candidates += 1;
        const distance = haversineMeters(query, child.point);
        if (distance <= radiusM) found.push({ id: child.point.id, distance });
      } else {
        stack.push(child);
      }
    }
  }
  return found.sort((a, b) => a.distance - b.distance);
}

// ── measurement ──────────────────────────────────────────────────────────────

const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
};
const round = (value, digits = 1) => Number(value.toFixed(digits));
// Banks on a shared point tie on distance, so compare in (distance, id) order.
const byDistanceThenId = (a, b) =>
  a.distance - b.distance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const sameIds = (a, b) => {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort(byDistanceThenId);
  const sortedB = [...b].sort(byDistanceThenId);
  return sortedA.every((bank, index) => bank.id === sortedB[index].id);
};

const queries = makeQueries();
const results = [];
for (const size of skipMemory ? [] : sizes) {
  const points = makeDataset(size);
  const builds = {};
  const timeBuild = (name, build) => {
    const started = performance.now();
    const index = build();
    builds[name] = round(performance.now() - started);
    return index;
  };
  const grid = timeBuild("grid", () => buildGrid(points));
  const kdTree = timeBuild("kdtree", () => buildKdTree(points));
  const rTree = timeBuild("rtree", () => buildRTree(points));
  const methods = {
    linear: (query, radius, counter) => linearSearch(points, query, radius, counter),
    rings: (query, radius, counter) => ringSearch(points, query, radius, counter).banks,
    grid: (query, radius, counter) => gridSearch(grid, query, radius, counter),
    kdtree: (query, radius, counter) => kdSearch(kdTree, query, radius, counter),
    rtree: (query, radius, counter) => rtreeSearch(rTree, query, radius, counter),
  };
  for (const radius of RADII_M) {
    const reference = queries.map((query) =>
      linearSearch(points, query, radius, { candidates: 0 }),
    );
    for (const [name, search] of Object.entries(methods)) {
      const times = [];
      let candidates = 0;
      queries.forEach((query, index) => {
        const counter = { candidates: 0 };
        const started = performance.now();
        const found = search(query, radius, counter);
        times.push((performance.now() - started) * 1000);
        candidates += counter.candidates;
        if (!sameIds(found, reference[index]))
          throw new Error(`${name} disagrees with linear at size ${size}`);
      });
      const result = {
        size,
        radiusKm: radius / 1000,
        method: name,
        buildMs: builds[name] ?? 0,
        p50Us: round(percentile(times, 0.5)),
        p95Us: round(percentile(times, 0.95)),
        candidatesPerQuery: Math.round(candidates / queries.length),
        resultsPerQuery: Math.round(
          reference.reduce((sum, list) => sum + list.length, 0) / queries.length,
        ),
      };
      results.push(result);
      console.log(
        `${String(size).padStart(7)} ${String(radius / 1000).padStart(4)} km ${name.padEnd(7)} build ${String(result.buildMs).padStart(7)} ms | p50 ${String(result.p50Us).padStart(9)} µs p95 ${String(result.p95Us).padStart(9)} µs | candidates ${String(result.candidatesPerQuery).padStart(7)} results ${result.resultsPerQuery}`,
      );
    }
  }
}

// ── PostGIS ──────────────────────────────────────────────────────────────────

if (usePostgis) {
  const { createRequire } = await import("node:module");
  const pg = createRequire(import.meta.url)("pg");
  if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
  const client = new pg.Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const postgisQueries = queries.slice(0, 40);
  const explainTime = async (table, query, radius) => {
    const { rows } = await client.query(
      `explain (analyze, format json)
       select id, extensions.st_distance(location, point) as distance
       from ${table}, (select extensions.st_setsrid(extensions.st_makepoint($1, $2), 4326)::extensions.geography as point) as q
       where extensions.st_dwithin(location, point, $3)
       order by distance`,
      [query.longitude, query.latitude, radius],
    );
    return rows[0]["QUERY PLAN"][0]["Execution Time"];
  };
  try {
    await client.query("select setseed(0.42)");
    for (const size of sizes) {
      const copies = Math.ceil(size / realBanks.length);
      await client.query("drop table if exists pg_temp.bench");
      await client.query(
        `create temp table bench as
         select row_number() over () as id,
                case when n = 1 then location
                     else extensions.st_setsrid(extensions.st_makepoint(
                            extensions.st_x(location::extensions.geometry) + (random() - 0.5) * 0.1,
                            extensions.st_y(location::extensions.geometry) + (random() - 0.5) * 0.1), 4326)::extensions.geography
                end as location
         from public.blood_banks, generate_series(1, $1) as n
         where location is not null
         limit $2`,
        [copies, size],
      );
      const indexStarted = performance.now();
      await client.query("create index on pg_temp.bench using gist (location)");
      const indexMs = round(performance.now() - indexStarted);
      await client.query("analyze pg_temp.bench");
      for (const radius of RADII_M) {
        for (const useIndex of [true, false]) {
          await client.query(
            `set enable_indexscan = ${useIndex}; set enable_bitmapscan = ${useIndex}`,
          );
          const times = [];
          for (const query of postgisQueries)
            times.push(await explainTime("pg_temp.bench", query, radius));
          const result = {
            size,
            radiusKm: radius / 1000,
            method: useIndex ? "postgis-gist" : "postgis-seqscan",
            buildMs: useIndex ? indexMs : 0,
            p50Us: round(percentile(times, 0.5) * 1000),
            p95Us: round(percentile(times, 0.95) * 1000),
            candidatesPerQuery: null,
            resultsPerQuery: null,
            note: "server execution time from EXPLAIN ANALYZE; network round trip (~175 ms) not included",
          };
          results.push(result);
          console.log(
            `${String(size).padStart(7)} ${String(radius / 1000).padStart(4)} km ${result.method.padEnd(16)} index ${String(result.buildMs).padStart(7)} ms | p50 ${String(result.p50Us).padStart(9)} µs p95 ${String(result.p95Us).padStart(9)} µs`,
          );
        }
      }
      await client.query("reset enable_indexscan; reset enable_bitmapscan");
    }
  } finally {
    await client.end();
  }
}

if (outFile) fs.writeFileSync(outFile, JSON.stringify({ queries: queryCount, results }, null, 2));
