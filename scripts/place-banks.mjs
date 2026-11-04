// Finds positions for the stocked banks location search can't place (#33, #34;
// docs/PLANS/plan_bank_locations.md, Part A), and measures how accurate each way of
// finding them is before any result is trusted.
//
//   node scripts/place-banks.mjs --control          each step on 200 banks whose position
//                                                   is known, with that position hidden
//   node scripts/place-banks.mjs --targets          the ladder on every bank search can't place
//   node scripts/place-banks.mjs --apply <file>     write a targets file to bank_location_fixes
//   options: --sample N (control size, default 200), --limit N (first N targets),
//            --offline (answer from the cache only; send nothing)
//
// Without --apply nothing is written to the database; reads run in a read-only
// transaction. --apply connects as bloodlink_ingest, like snapshot.mjs, and needs the
// migration 20261105000100_bank_location_fixes.sql.
//
// The ladder, for each bank, stops at the first step that gives a position passing
// every check:
//   1. datagov            15 banks placed confidently from data.gov.in (report 3, 3.2)
//   2. nominatim_name     the bank's or its parent hospital's name, as a health facility
//   3. nominatim_address  the address, structured, then free-form
//   4. pincode            the PIN code's centre
// Checks: inside its own state (src/lib/stateBounds.js), inside its own district's
// outline when one is known, a distinctive name word in common (name step), street or
// building level (address step), and not on a point 3 or more other banks landed on.
// A step's positions are accepted only if the control measured it within 2 km for 90%
// of banks with at most 2% false matches (src/lib/bankPlacement.js); else they wait in
// the review queue (/admin/locations).
//
// Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/):
// one thread on one machine, at most one request a second (a 1.1 s gap here), an
// identifying User-Agent, and every answer cached. The cache is
// ../blood_data/geocoding/nominatim_cache.ndjson, keyed by the full query, so a re-run
// sends nothing it has sent before. The run stops on HTTP 429 or 403 and says where.
// Scripts run at regular intervals are limited to 4 requests a minute: a later weekly
// job for new banks must slow down to that.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createStateChecker } from "../src/lib/stateBounds.js";
import { districtFromAddress, cleanText } from "../src/lib/stock.js";
import { haversineMeters } from "../src/lib/geo.js";
import {
  accuracyOf,
  addressParts,
  centroidTraps,
  cleanAddress,
  distinctiveWords,
  errorMeters,
  extractPin,
  isHealthFacility,
  isPostcode,
  isSpecific,
  nameWords,
  placeWordsOf,
  pointKey,
  searchName,
  seededShuffle,
  sharesDistinctiveWord,
  stateViewbox,
} from "../src/lib/bankPlacement.js";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const DATA_DIR = path.join(APP_DIR, "../blood_data");
const OUT_DIR = path.join(DATA_DIR, "geocoding");
const CACHE_FILE = path.join(OUT_DIR, "nominatim_cache.ndjson");
const DISTRICTS_FILE = path.join(OUT_DIR, "district_outlines.json");
const GEOBOUNDARIES_FILE = path.join(
  DATA_DIR,
  "external/geoboundaries/geoBoundaries-IND-ADM2_simplified.geojson",
);
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT =
  "bloodLink/0.1 (B.Tech project, placing blood banks for search; https://github.com/dark756/bloodlink)";
const REQUEST_GAP_MS = 1_100;
const TIMEOUT_MS = 20_000;
const DISTRICT_MARGIN_KM = 5;
const DATAGOV_PRECISION_M = 300;
const TRUTH_AGREEMENT_M = 300;
const DENSITY_RADIUS_M = 15_000; // as /api/blood-search: more than 10 banks means urban
const DENSE_AREA_MIN_BANKS = 10;
// A step x area cell needs this many placed control banks to be judged on its own.
const MIN_CELL_PLACED = 20;
const STEPS = ["nominatim_name", "nominatim_address", "pincode"];
// How positions are judged: the steps, with town-only name matches apart.
const JUDGED_STEPS = ["nominatim_name", "nominatim_name_town", "nominatim_address", "pincode"];

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const districtData = readJson(path.join(APP_DIR, "assets/district_data.json"));
const stateBoundaries = readJson(path.join(APP_DIR, "assets/state_boundaries.json"));
const stateChecker = createStateChecker(stateBoundaries);
const statesByCode = new Map(
  districtData.statesWithDistricts.map((state) => [String(state.stateCode), state]),
);
const today = new Date().toISOString().slice(0, 10);

// ── command line ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const mode = flag("--control")
  ? "control"
  : flag("--targets")
    ? "targets"
    : flag("--apply")
      ? "apply"
      : null;
if (!mode) {
  console.error("Usage: node scripts/place-banks.mjs --control | --targets | --apply <file>");
  process.exit(1);
}
const isOffline = flag("--offline");

// ── small helpers ────────────────────────────────────────────────────────────

// RFC 4180 rows, with quoted fields.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let isQuoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (isQuoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') isQuoted = false;
      else field += char;
    } else if (char === '"') isQuoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) rows.push([...row, field]);
  const [header, ...body] = rows.filter((cells) => cells.some((cell) => cell !== ""));
  return body.map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ""])));
}

const districtName = (stateCode, districtId) =>
  statesByCode
    .get(String(stateCode))
    ?.districts.find((district) => String(district.districtCode) === String(districtId))
    ?.districtName ?? null;

// ── district outlines (geoBoundaries ADM2, 2021, ODbL) ───────────────────────

// A crude spelling key, so "Ahmadnagar" meets "Ahmednagar" and "Kancheepuram" meets
// "Kanchipuram".
const spellingKey = (name) =>
  String(name ?? "")
    .toLowerCase()
    .replace(/\b(district|dist)\b/g, "")
    .replace(/[^a-z]/g, "")
    .replace(/(.)\1+/g, "$1")
    .replace(/[aeiouy]+/g, "a")
    .replace(/w/g, "v")
    .replace(/([kgcjtdpbs])h/g, "$1")
    .replace(/z/g, "j");
const bigrams = (text) => {
  const grams = new Map();
  for (let i = 0; i < text.length - 1; i += 1) {
    const gram = text.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
};
function dice(a, b) {
  if (a === b) return 1;
  const gramsA = bigrams(a);
  const gramsB = bigrams(b);
  let shared = 0;
  for (const [gram, count] of gramsA) shared += Math.min(count, gramsB.get(gram) ?? 0);
  const total = a.length - 1 + (b.length - 1);
  return total <= 0 ? 0 : (2 * shared) / total;
}

// Area-weighted centre of a ring of [lon, lat].
function ringCentroid(ring) {
  let area = 0;
  let x = 0;
  let y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    area += cross;
    x += (ring[j][0] + ring[i][0]) * cross;
    y += (ring[j][1] + ring[i][1]) * cross;
  }
  if (area === 0) return { longitude: ring[0][0], latitude: ring[0][1] };
  return { longitude: x / (3 * area), latitude: y / (3 * area) };
}

// geoBoundaries has district names but no state. Each outline gets the state its
// points fall in, then is matched by name to eRaktKosh's districts of that state.
function buildDistrictOutlines() {
  const geo = readJson(GEOBOUNDARIES_FILE);
  const byState = new Map();
  for (const feature of geo.features) {
    const { type, coordinates } = feature.geometry;
    const polygons = type === "Polygon" ? [coordinates] : coordinates;
    const points = polygons.flatMap((polygon) => polygon[0]);
    let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [lon, lat] of points) {
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    // Vote: the centre of the largest polygon, plus up to 24 of its outline's points.
    const largest = polygons.reduce((a, b) => (b[0].length > a[0].length ? b : a));
    const step = Math.max(1, Math.floor(largest[0].length / 24));
    const samples = [ringCentroid(largest[0])];
    for (let i = 0; i < largest[0].length; i += step) {
      samples.push({ longitude: largest[0][i][0], latitude: largest[0][i][1] });
    }
    const votes = new Map();
    for (const sample of samples) {
      for (const [code, state] of Object.entries(stateBoundaries.states)) {
        const [w, s, e, n] = state.bbox;
        if (
          sample.longitude < w ||
          sample.longitude > e ||
          sample.latitude < s ||
          sample.latitude > n
        )
          continue;
        if ((stateChecker.distanceOutsideStateKm(sample, code) ?? Infinity) <= 1) {
          votes.set(code, (votes.get(code) ?? 0) + 1);
        }
      }
    }
    const [stateCode] = [...votes].sort((a, b) => b[1] - a[1])[0] ?? [null];
    if (!stateCode) continue;
    if (!byState.has(stateCode)) byState.set(stateCode, []);
    byState.get(stateCode).push({
      outlineName: feature.properties.shapeName,
      bbox: [west, south, east, north],
      polygons,
    });
  }

  // A wrong outline would let a misplaced bank pass, so a match must be the same
  // spelling key, or a close one that starts with the same two letters and is each
  // other's best ("Haridwar" and "Hardwar", but not "Pauri Garhwal" and "Tehri Garhwal").
  const prefix = (name) =>
    String(name)
      .toLowerCase()
      .replace(/[^a-z]/g, "")
      .slice(0, 2);
  const states = {};
  const unmatched = [];
  for (const state of districtData.statesWithDistricts) {
    const outlines = byState.get(String(state.stateCode)) ?? [];
    const scoreOf = (district, outline) =>
      dice(spellingKey(district.districtName), spellingKey(outline.outlineName));
    const bestDistrictOf = new Map(
      outlines.map((outline) => [
        outline,
        state.districts.reduce((a, b) => (scoreOf(b, outline) > scoreOf(a, outline) ? b : a)),
      ]),
    );
    for (const district of state.districts) {
      let best = null;
      for (const outline of outlines) {
        const score = scoreOf(district, outline);
        if (!best || score > best.score) best = { outline, score };
      }
      const isMatch =
        best &&
        (best.score === 1 ||
          (best.score >= 0.75 &&
            prefix(district.districtName) === prefix(best.outline.outlineName) &&
            bestDistrictOf.get(best.outline) === district));
      if (isMatch) {
        states[String(district.districtCode)] = {
          name: district.districtName,
          stateCode: String(state.stateCode),
          outlineName: best.outline.outlineName,
          score: Number(best.score.toFixed(2)),
          bbox: best.outline.bbox,
          polygons: best.outline.polygons,
        };
      } else {
        unmatched.push(`${state.stateName}: ${district.districtName}`);
      }
    }
  }
  const outlines = {
    source:
      "geoBoundaries gbOpen IND ADM2 (2021), simplified; Pathways Data Pvt. Ltd., lgdirectory.gov.in",
    license: "Open Data Commons Open Database License 1.0",
    builtOn: today,
    notes:
      "Keyed by eRaktKosh district code (assets/district_data.json). Outlines were given a state by the state outlines and matched by name within it: the same spelling key, or a bigram similarity of at least 0.75 with the same first two letters, each the other's best. Districts created after 2021, or spelt too differently, have no outline, and their banks skip the district check.",
    matched: Object.keys(states).length,
    unmatched,
    states,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(DISTRICTS_FILE, JSON.stringify(outlines));
  return outlines;
}

function loadDistrictChecker() {
  const outlines = fs.existsSync(DISTRICTS_FILE)
    ? readJson(DISTRICTS_FILE)
    : buildDistrictOutlines();
  console.log(
    `district outlines: ${outlines.matched} of ${outlines.matched + outlines.unmatched.length} eRaktKosh districts matched`,
  );
  const checker = createStateChecker(outlines, { marginKm: DISTRICT_MARGIN_KM });
  return {
    has: (districtId) => Boolean(districtId && outlines.states[String(districtId)]),
    // null when there is no outline to check against.
    isInside: (position, districtId) =>
      outlines.states[String(districtId)]
        ? checker.locationProblem({ ...position, stateCode: String(districtId) }) === null
        : null,
  };
}

// ── Nominatim, cached ────────────────────────────────────────────────────────

class StopError extends Error {}
const cache = new Map();
if (fs.existsSync(CACHE_FILE)) {
  for (const line of fs.readFileSync(CACHE_FILE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      cache.set(entry.key, entry.body);
    } catch {
      // A line cut short by a stopped run is skipped.
    }
  }
}
const counters = { requests: 0, cached: 0, failed: 0, notCached: 0 };
let nextSlotAt = 0;

async function nominatim(params) {
  const query = {
    ...Object.fromEntries(Object.entries(params).filter(([, value]) => value)),
    format: "jsonv2",
    addressdetails: "1",
    limit: "5",
    countrycodes: "in",
    "accept-language": "en",
  };
  const key = new URLSearchParams(
    Object.entries(query).sort(([a], [b]) => a.localeCompare(b)),
  ).toString();
  if (cache.has(key)) {
    counters.cached += 1;
    return cache.get(key);
  }
  if (isOffline) {
    counters.notCached += 1;
    return [];
  }
  const wait = nextSlotAt - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  nextSlotAt = Date.now() + REQUEST_GAP_MS;
  counters.requests += 1;
  let response;
  try {
    response = await fetch(`${NOMINATIM_URL}?${key}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    counters.failed += 1;
    console.warn(`nominatim: ${error.name} for ${key.slice(0, 120)}`);
    return [];
  }
  if (response.status === 429 || response.status === 403) {
    throw new StopError(`Nominatim answered HTTP ${response.status}; stopping`);
  }
  if (!response.ok) {
    counters.failed += 1;
    console.warn(`nominatim: HTTP ${response.status} for ${key.slice(0, 120)}`);
    return [];
  }
  const body = await response.json();
  cache.set(key, body);
  fs.appendFileSync(CACHE_FILE, `${JSON.stringify({ key, at: new Date().toISOString(), body })}\n`);
  return Array.isArray(body) ? body : [];
}

// ── one bank ─────────────────────────────────────────────────────────────────

// bank: { hospitalCode, stateCode, districtId, name, address, pin }
function bankContext(bank) {
  const state = statesByCode.get(String(bank.stateCode));
  const district = districtName(bank.stateCode, bank.districtId);
  const placeWords = placeWordsOf(state?.stateName ?? "", district ?? "", "india");
  const { city } = addressParts(cleanAddress(bank.address, { name: bank.name }), {
    stateName: state?.stateName,
    districtName: district,
  });
  return {
    state,
    district,
    placeWords,
    // The town's words: a name match on them alone ("Bsu Ah Rayadurgam" and any
    // Rayadurgam hospital) goes to review, whatever the control says.
    townWords: placeWordsOf(city ?? ""),
    viewbox: stateViewbox(stateBoundaries.states[String(bank.stateCode)]),
  };
}

// The step a candidate is judged as: a name match only on the town's words is its own.
const NAME_TOWN_STEP = "nominatim_name_town";

const toPosition = (result) => ({ latitude: Number(result.lat), longitude: Number(result.lon) });

// The checks every candidate must pass, except the centroid trap, which needs the
// whole run (applied afterwards). Returns { reason } for a rejection, else { townOnly }.
function passesChecks(bank, result, step, context, districts) {
  const position = toPosition(result);
  const reject = (reason) => ({ reason });
  if (!Number.isFinite(position.latitude) || !Number.isFinite(position.longitude))
    return reject("no point");
  if (stateChecker.locationProblem({ ...position, stateCode: bank.stateCode }) !== null)
    return reject("outside its state");
  if (districts.isInside(position, bank.districtId) === false)
    return reject("outside its district");
  if (step === "nominatim_name") {
    if (!isHealthFacility(result)) return reject("not a health facility");
    const found = result.name || String(result.display_name ?? "").split(",")[0];
    if (!sharesDistinctiveWord(bank.searchName, found, context.placeWords))
      return reject("no distinctive word in common");
    const bankWords = distinctiveWords(bank.searchName, context.placeWords);
    const shared = [...distinctiveWords(found, context.placeWords)].filter((w) => bankWords.has(w));
    return { reason: null, townOnly: shared.every((word) => context.townWords.has(word)) };
  }
  if (step === "nominatim_address" && !isSpecific(result))
    return reject("not street or building level");
  if (step === "pincode" && !(isPostcode(result) || result.address?.postcode === bank.pin))
    return reject("not the PIN code");
  return { reason: null, townOnly: false };
}

const evidenceOf = (result, query) => ({
  query,
  osm: result.osm_type && result.osm_id ? `${result.osm_type}/${result.osm_id}` : null,
  name: result.name || null,
  displayName: result.display_name ?? null,
  category: result.category ?? null,
  type: result.type ?? null,
  placeRank: result.place_rank ?? null,
});

// The first result of a query that passes the checks, with every rejection reason.
async function tryQuery(bank, step, params, context, districts) {
  const results = await nominatim({ ...params, viewbox: context.viewbox, bounded: "1" });
  const rejected = [];
  for (const result of results) {
    const { reason, townOnly } = passesChecks(bank, result, step, context, districts);
    if (reason === null) {
      return {
        candidate: {
          ...toPosition(result),
          judgedAs: townOnly ? NAME_TOWN_STEP : step,
          evidence: { ...evidenceOf(result, params), ...(townOnly ? { townOnly: true } : {}) },
        },
        rejected,
      };
    }
    rejected.push(reason);
  }
  return { candidate: null, rejected };
}

// One step for one bank: { candidate, tried, rejected }. tried is false when the step
// doesn't apply (no distinctive name word, no address, no PIN).
async function runStep(bank, step, context, districts) {
  if (step === "nominatim_name") {
    if (distinctiveWords(bank.searchName, context.placeWords).size === 0) {
      return { tried: false, candidate: null, rejected: ["no distinctive name word"] };
    }
    const q = [bank.searchName, context.district, context.state?.stateName]
      .filter(Boolean)
      .join(", ");
    return { tried: true, ...(await tryQuery(bank, step, { q }, context, districts)) };
  }
  if (step === "nominatim_address") {
    const cleaned = cleanAddress(bank.address, { name: bank.name });
    if (!cleaned) return { tried: false, candidate: null, rejected: ["no address"] };
    const { street, city } = addressParts(cleaned, {
      stateName: context.state?.stateName,
      districtName: context.district,
    });
    // Without a street there is nothing street-level to find: a query of the town alone
    // returns some building in it ("Mumbai, Mumbai, Maharashtra" gave the securities
    // regulator's office for St George's Hospital in the control run). A "street" that
    // only repeats the town or district ("Rayadurgam, , RAYADURGAM") counts as none.
    const streetWords = nameWords(street).filter(
      (word) =>
        !/^\d+$/.test(word) && !context.townWords.has(word) && !context.placeWords.has(word),
    );
    if (streetWords.length === 0) {
      return { tried: false, candidate: null, rejected: ["no street to search for"] };
    }
    const structured = await tryQuery(
      bank,
      step,
      {
        street,
        city,
        county: context.district,
        state: context.state?.stateName,
        postalcode: bank.pin,
        country: "India",
      },
      context,
      districts,
    );
    if (structured.candidate) return { tried: true, ...structured };
    const q = [cleaned, context.state?.stateName].filter(Boolean).join(", ");
    const freeForm = await tryQuery(bank, step, { q }, context, districts);
    return {
      tried: true,
      candidate: freeForm.candidate,
      rejected: [...structured.rejected, ...freeForm.rejected],
    };
  }
  if (step === "pincode") {
    if (!bank.pin) return { tried: false, candidate: null, rejected: ["no PIN code"] };
    return {
      tried: true,
      ...(await tryQuery(
        bank,
        step,
        { postalcode: bank.pin, country: "India" },
        context,
        districts,
      )),
    };
  }
  throw new Error(`unknown step ${step}`);
}

// ── reading the store ────────────────────────────────────────────────────────

async function connect({ write = false } = {}) {
  process.loadEnvFile(path.join(APP_DIR, ".env.local"));
  if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is not set (.env.local)");
  const client = new pg.Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  if (write) await client.query("set role bloodlink_ingest");
  else await client.query("begin read only");
  return client;
}

// Banks whose own point search can use, for the urban/rural split.
async function loadVisiblePoints(client) {
  const { rows } = await client.query(
    `select latitude, longitude from public.blood_banks
     where latitude is not null and location_quality in ('ok', 'shared')`,
  );
  return rows.map((row) => ({ latitude: Number(row.latitude), longitude: Number(row.longitude) }));
}
const areaOf = (position, points) =>
  points.filter((point) => haversineMeters(position, point) <= DENSITY_RADIUS_M).length >
  DENSE_AREA_MIN_BANKS
    ? "urban"
    : "rural";

// The stock row's name and address, as the targets have only those.
function toBank(row) {
  const name = cleanText(row.stock_name) || cleanText(row.dir_name) || "";
  const address = cleanText(row.stock_address) || cleanText(row.dir_address) || "";
  const state = statesByCode.get(String(row.state_code));
  const districtId =
    row.district_id ??
    districtFromAddress(address, state?.stateName, state?.districts ?? []) ??
    null;
  const type = row.stock_type || row.bank_type || null;
  return {
    hospitalCode: String(row.hospital_code),
    stateCode: String(row.state_code),
    districtId: districtId === null ? null : String(districtId),
    name,
    searchName: searchName(name),
    address,
    pin: extractPin(address),
    type: /bsu|storage/i.test(`${type} ${name}`) ? "BSU" : "Blood Bank",
  };
}

async function loadTargets(client) {
  const { rows } = await client.query(
    `select s.hospital_code, s.state_code, coalesce(s.district_id, b.district_id) as district_id,
       s.row->>'hospitalname' as stock_name, s.row->>'hospitaladd' as stock_address,
       s.row->>'type' as stock_type, b.name as dir_name, b.address as dir_address, b.bank_type,
       case when b.hospital_code is null or b.latitude is null then 'missing'
            else b.location_quality end as reason
     from public.bank_stock_latest s
     left join public.blood_banks b using (hospital_code)
     where b.hospital_code is null or b.latitude is null
        or b.location_quality in ('wrong_state', 'outside_india')
     order by s.hospital_code`,
  );
  return rows.map((row) => ({ ...toBank(row), reason: row.reason }));
}

// Banks where eRaktKosh and data.gov.in agree within 300 m: the best truth there is.
async function loadControl(client, sampleSize, points) {
  const crosswalk = parseCsv(
    fs.readFileSync(path.join(DATA_DIR, "crosswalk/datagovin_to_eraktkosh.csv"), "utf8"),
  ).filter(
    (row) =>
      row.verdict === "match" && Number(row.distance_m) <= TRUTH_AGREEMENT_M && row.eraktkosh_code,
  );
  const codes = [...new Set(crosswalk.map((row) => row.eraktkosh_code))];
  const { rows } = await client.query(
    `select b.hospital_code, b.state_code, coalesce(b.district_id, s.district_id) as district_id,
       s.row->>'hospitalname' as stock_name, s.row->>'hospitaladd' as stock_address,
       s.row->>'type' as stock_type, b.name as dir_name, b.address as dir_address, b.bank_type,
       b.latitude, b.longitude
     from public.blood_banks b
     left join public.bank_stock_latest s using (hospital_code)
     where b.hospital_code = any($1::text[]) and b.location_quality = 'ok'`,
    [codes],
  );
  const banks = rows.map((row) => {
    const truth = { latitude: Number(row.latitude), longitude: Number(row.longitude) };
    return { ...toBank(row), truth, area: areaOf(truth, points) };
  });
  // Stratified by type and area, one from each in turn, from a fixed shuffle.
  const strata = new Map();
  for (const bank of seededShuffle(banks, 20261105)) {
    const key = `${bank.type}|${bank.area}`;
    if (!strata.has(key)) strata.set(key, []);
    strata.get(key).push(bank);
  }
  const sample = [];
  while (sample.length < Math.min(sampleSize, banks.length)) {
    for (const list of strata.values())
      if (list.length && sample.length < sampleSize) sample.push(list.shift());
  }
  return { sample, pool: banks.length };
}

// ── runs ─────────────────────────────────────────────────────────────────────

const pct = (value) =>
  value === null || value === undefined ? "—" : `${(100 * value).toFixed(0)}%`;
const km = (meters) =>
  meters === null || meters === undefined ? "—" : `${(meters / 1000).toFixed(2)} km`;

async function runControl() {
  const client = await connect();
  let sample;
  let pool;
  let points;
  try {
    points = await loadVisiblePoints(client);
    ({ sample, pool } = await loadControl(client, Number(option("--sample", 200)), points));
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
  const districts = loadDistrictChecker();
  const states = new Set(sample.map((bank) => bank.stateCode));
  console.log(
    `control: ${sample.length} of ${pool} agreeing banks, ${states.size} states, ` +
      `${sample.filter((b) => b.type === "BSU").length} storage units, ` +
      `${sample.filter((b) => b.area === "rural").length} rural`,
  );
  const outcomes = [];
  let stopped = null;
  try {
    for (const [index, bank] of sample.entries()) {
      const context = bankContext(bank);
      const steps = {};
      for (const step of STEPS) {
        const outcome = await runStep(bank, step, context, districts);
        steps[step] = {
          tried: outcome.tried,
          judgedAs: outcome.candidate?.judgedAs ?? step,
          position: outcome.candidate
            ? { latitude: outcome.candidate.latitude, longitude: outcome.candidate.longitude }
            : null,
          errorM: outcome.candidate ? Math.round(errorMeters(outcome.candidate, bank.truth)) : null,
          evidence: outcome.candidate?.evidence ?? null,
          rejected: outcome.rejected,
        };
      }
      outcomes.push({
        hospitalCode: bank.hospitalCode,
        stateCode: bank.stateCode,
        districtId: bank.districtId,
        hasDistrictOutline: districts.has(bank.districtId),
        type: bank.type,
        area: bank.area,
        name: bank.name,
        pin: bank.pin,
        steps,
      });
      if ((index + 1) % 20 === 0) {
        console.log(
          `  ${index + 1}/${sample.length} banks; ${counters.requests} requests, ${counters.cached} cached`,
        );
      }
    }
  } catch (error) {
    if (!(error instanceof StopError)) throw error;
    stopped = `${error.message} after ${outcomes.length} banks`;
    console.error(stopped);
  }

  // The centroid trap, over the whole run.
  for (const step of STEPS) {
    const traps = centroidTraps(outcomes.map((o) => o.steps[step].position).filter(Boolean));
    for (const outcome of outcomes) {
      const result = outcome.steps[step];
      if (result.position && traps.has(pointKey(result.position))) {
        result.rejected.push("centroid trap");
        result.position = null;
        result.errorM = null;
      }
    }
  }

  const accuracy = {};
  for (const judged of JUDGED_STEPS) {
    const step = judged === NAME_TOWN_STEP ? "nominatim_name" : judged;
    const tried = outcomes.filter((o) => o.steps[step].tried);
    const errors = (list) =>
      list
        .filter((o) => o.steps[step].judgedAs === judged)
        .map((o) => o.steps[step].errorM)
        .filter((e) => e !== null);
    accuracy[judged] = { all: accuracyOf(errors(tried), tried.length) };
    for (const area of ["urban", "rural"]) {
      const cell = tried.filter((o) => o.area === area);
      accuracy[judged][area] = accuracyOf(errors(cell), cell.length);
    }
  }
  // The ladder as the target run takes it: the first step accepted for the bank's area,
  // else the first position found, which would wait for review.
  const judge = acceptanceFrom(accuracy);
  const acceptedErrors = [];
  const reviewErrors = [];
  for (const outcome of outcomes) {
    const found = STEPS.map((step) => outcome.steps[step]).filter((s) => s.errorM !== null);
    const accepted = found.find((s) => judge(s.judgedAs, outcome.area).accepted);
    if (accepted) acceptedErrors.push(accepted.errorM);
    else if (found.length) reviewErrors.push(found[0].errorM);
  }
  const ladder = {
    accepted: accuracyOf(acceptedErrors, outcomes.length),
    review: accuracyOf(reviewErrors, outcomes.length),
  };

  const report = {
    ranOn: new Date().toISOString(),
    sample: {
      banks: outcomes.length,
      pool,
      states: new Set(outcomes.map((o) => o.stateCode)).size,
      storageUnits: outcomes.filter((o) => o.type === "BSU").length,
      rural: outcomes.filter((o) => o.area === "rural").length,
      withDistrictOutline: outcomes.filter((o) => o.hasDistrictOutline).length,
      withPin: outcomes.filter((o) => o.pin).length,
    },
    rule: "accepted automatically if p90 <= 2 km and false matches (> 10 km) <= 2%; a step x area cell is judged on its own when it placed at least 20 banks",
    accuracy,
    ladder,
    requests: { ...counters },
    stopped,
    outcomes,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const base = path.join(OUT_DIR, `control_${today}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(report, null, 1));

  const lines = [
    `# Placement control run, ${today}`,
    "",
    `${report.sample.banks} banks where eRaktKosh and data.gov.in agree within 300 m (of ${pool}), ${report.sample.states} states, ${report.sample.storageUnits} storage units, ${report.sample.rural} rural. Their positions were hidden and each step run on every bank. ${report.sample.withDistrictOutline} had a district outline to check against, and ${report.sample.withPin} a PIN code in the address.`,
    "",
    "Rule, fixed before the run: a step is accepted automatically if 90% of its positions are within 2 km and at most 2% are more than 10 km off.",
    "",
    "| Step | Area | Tried | Placed | Yield | Median | p90 | Within 1 km | Within 2 km | Within 5 km | False matches | Accepted |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const judged of JUDGED_STEPS) {
    for (const area of ["all", "urban", "rural"]) {
      const a = accuracy[judged][area];
      lines.push(
        `| ${judged} | ${area} | ${a.banksTried} | ${a.placed} | ${pct(a.yield)} | ${km(a.medianM)} | ${km(a.p90M)} | ${pct(a.within1Km)} | ${pct(a.within2Km)} | ${pct(a.within5Km)} | ${a.falseMatches} | ${a.accepted ? "**yes**" : "no"} |`,
      );
    }
  }
  const { accepted: la, review: lr } = ladder;
  lines.push(
    "",
    `\`${NAME_TOWN_STEP}\` is a name match whose only shared words are the town's; the target run sends those to review whatever this table says. A step x area cell is judged on its own when it placed at least ${MIN_CELL_PLACED} banks, else by the step's "all" row.`,
    "",
    `**The ladder, as the target run takes it:** ${la.placed} of ${la.banksTried} banks (${pct(la.yield)}) would be accepted automatically, with a median error of ${km(la.medianM)}, p90 ${km(la.p90M)} and ${la.falseMatches} false matches. Another ${lr.placed} would wait for review (median ${km(lr.medianM)}, p90 ${km(lr.p90M)}, ${lr.falseMatches} false matches).`,
    "",
    `Requests: ${counters.requests} sent, ${counters.cached} from the cache, ${counters.failed} failed.${stopped ? ` **Stopped:** ${stopped}.` : ""}`,
    "",
    "Known bias: the truth set leans towards older, well-documented banks, because the data.gov.in list is older. The targets include many storage units and newer banks, so expect a lower yield on them; accuracy per accepted match should transfer better than yield.",
  );
  fs.writeFileSync(`${base}.md`, `${lines.join("\n")}\n`);
  console.log(lines.slice(6).join("\n"));
  console.log(`\nsaved ${path.relative(APP_DIR, base)}.json and .md`);
}

// A control run's verdict and precision for a judged step in a bank's area. A cell
// with fewer than MIN_CELL_PLACED positions is judged by the step's "all" row, and a
// step with fewer than that is never accepted: too few to trust. Town-only name
// matches always go to review.
function acceptanceFrom(accuracy) {
  return (judged, area) => {
    const cell = accuracy[judged]?.[area];
    const stats = cell && cell.placed >= MIN_CELL_PLACED ? cell : accuracy[judged]?.all;
    if (!stats || stats.placed === 0) return { accepted: false, precisionM: 5_000 };
    return {
      accepted: judged !== NAME_TOWN_STEP && stats.placed >= MIN_CELL_PLACED && stats.accepted,
      // The step's 90th-percentile error, rounded up to 50 m; never below the
      // data.gov.in tier.
      precisionM: Math.max(DATAGOV_PRECISION_M, Math.ceil((stats.p90M ?? 5_000) / 50) * 50),
    };
  };
}

// The latest control run's verdicts.
function loadAcceptance() {
  const files = fs
    .readdirSync(OUT_DIR)
    .filter((name) => /^control_\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort();
  if (files.length === 0) throw new Error("no control run yet: run --control first");
  const report = readJson(path.join(OUT_DIR, files.at(-1)));
  return { file: files.at(-1), judge: acceptanceFrom(report.accuracy) };
}

async function runTargets() {
  const client = await connect();
  let targets;
  let points;
  try {
    points = await loadVisiblePoints(client);
    targets = await loadTargets(client);
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
  const limit = Number(option("--limit", targets.length));
  targets = targets.slice(0, limit);
  const acceptance = loadAcceptance();
  const districts = loadDistrictChecker();
  const datagov = new Map(
    parseCsv(
      fs.readFileSync(path.join(DATA_DIR, "crosswalk/coordinates_for_unlocated_banks.csv"), "utf8"),
    )
      .filter((row) => row.confident === "True" && row.latitude && row.longitude)
      .map((row) => [row.hospital_code, row]),
  );
  console.log(
    `targets: ${targets.length} stocked banks search can't place ` +
      `(${targets.filter((t) => t.reason === "missing").length} missing, ` +
      `${targets.filter((t) => t.reason === "wrong_state").length} wrong state, ` +
      `${targets.filter((t) => t.reason === "outside_india").length} outside India); control ${acceptance.file}`,
  );

  const placements = [];
  const unplaced = [];
  let stopped = null;
  try {
    for (const [index, bank] of targets.entries()) {
      const context = bankContext(bank);
      const tried = {};
      let placement = null;
      const fromCrosswalk = datagov.get(bank.hospitalCode);
      if (fromCrosswalk) {
        const position = {
          latitude: Number(fromCrosswalk.latitude),
          longitude: Number(fromCrosswalk.longitude),
        };
        if (stateChecker.locationProblem({ ...position, stateCode: bank.stateCode }) === null) {
          placement = {
            method: "datagov",
            ...position,
            status: "accepted",
            precisionM: DATAGOV_PRECISION_M,
            evidence: {
              datagovName: fromCrosswalk.datagovin_name,
              datagovDistrict: fromCrosswalk.datagovin_district,
              nameSimilarity: Number(fromCrosswalk.name_similarity),
            },
          };
        } else tried.datagov = ["outside its state"];
      }
      // Down the ladder until a step's position is accepted; the first position
      // found is kept for review when none is.
      let forReview = null;
      for (const step of STEPS) {
        if (placement) break;
        const outcome = await runStep(bank, step, context, districts);
        tried[step] = outcome.tried ? outcome.rejected : ["not tried", ...outcome.rejected];
        if (!outcome.candidate) continue;
        const area = areaOf(outcome.candidate, points);
        const verdict = acceptance.judge(outcome.candidate.judgedAs, area);
        const found = {
          method: step,
          judgedAs: outcome.candidate.judgedAs,
          latitude: outcome.candidate.latitude,
          longitude: outcome.candidate.longitude,
          status: verdict.accepted ? "accepted" : "proposed",
          precisionM: verdict.precisionM,
          area,
          evidence: outcome.candidate.evidence,
        };
        if (verdict.accepted) placement = found;
        else forReview ??= found;
      }
      placement ??= forReview;
      const record = {
        hospitalCode: bank.hospitalCode,
        stateCode: bank.stateCode,
        districtId: bank.districtId,
        reason: bank.reason,
        type: bank.type,
        name: bank.name,
        address: bank.address,
        pin: bank.pin,
        tried,
      };
      if (placement) placements.push({ ...record, ...placement });
      else unplaced.push(record);
      if ((index + 1) % 25 === 0) {
        console.log(
          `  ${index + 1}/${targets.length}: ${placements.length} placed; ${counters.requests} requests, ${counters.cached} cached`,
        );
      }
    }
  } catch (error) {
    if (!(error instanceof StopError)) throw error;
    stopped = `${error.message} after ${placements.length + unplaced.length} banks`;
    console.error(stopped);
  }

  // The centroid trap, over the whole run: positions from the geocoder only.
  const traps = centroidTraps(placements.filter((p) => p.method !== "datagov"));
  const kept = [];
  for (const placement of placements) {
    if (placement.method !== "datagov" && traps.has(pointKey(placement))) {
      unplaced.push({
        ...placement,
        tried: { ...placement.tried, [placement.method]: ["centroid trap"] },
      });
    } else kept.push(placement);
  }

  const count = (list, test) => list.filter(test).length;
  const byMethod = {};
  for (const placement of kept) {
    byMethod[placement.method] ??= { accepted: 0, proposed: 0 };
    byMethod[placement.method][placement.status] += 1;
  }
  const report = {
    ranOn: new Date().toISOString(),
    control: acceptance.file,
    targets: targets.length,
    placed: kept.length,
    accepted: count(kept, (p) => p.status === "accepted"),
    proposed: count(kept, (p) => p.status === "proposed"),
    unplaced: unplaced.length,
    byMethod,
    byReason: Object.fromEntries(
      ["missing", "wrong_state", "outside_india"].map((reason) => [
        reason,
        {
          targets: count(targets, (t) => t.reason === reason),
          accepted: count(kept, (p) => p.reason === reason && p.status === "accepted"),
          proposed: count(kept, (p) => p.reason === reason && p.status === "proposed"),
        },
      ]),
    ),
    requests: { ...counters },
    stopped,
    placements: kept,
    unplacedBanks: unplaced,
  };
  const base = path.join(OUT_DIR, `targets_${today}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(report, null, 1));
  const lines = [
    `# Placement target run, ${today}`,
    "",
    `${targets.length} stocked banks location search can't place. Acceptance from \`${acceptance.file}\`.`,
    "",
    "| Reason | Banks | Accepted | Proposed (review queue) | Not placed |",
    "|---|---|---|---|---|",
    ...Object.entries(report.byReason).map(
      ([reason, r]) =>
        `| ${reason} | ${r.targets} | ${r.accepted} | ${r.proposed} | ${r.targets - r.accepted - r.proposed} |`,
    ),
    `| **All** | ${targets.length} | ${report.accepted} | ${report.proposed} | ${report.unplaced} |`,
    "",
    "| Method | Accepted | Proposed |",
    "|---|---|---|",
    ...Object.entries(byMethod).map(
      ([method, m]) => `| ${method} | ${m.accepted} | ${m.proposed} |`,
    ),
    "",
    `Requests: ${counters.requests} sent, ${counters.cached} from the cache, ${counters.failed} failed.${stopped ? ` **Stopped:** ${stopped}; run again to resume from the cache.` : ""}`,
  ];
  fs.writeFileSync(`${base}.md`, `${lines.join("\n")}\n`);
  console.log(lines.slice(4).join("\n"));
  console.log(`\nsaved ${path.relative(APP_DIR, base)}.json and .md`);
}

// Writes a targets file to bank_location_fixes. A fix a person reviewed, or one they
// placed or a bank confirmed, is never overwritten.
async function runApply() {
  const file = option("--apply", null);
  if (!file || !fs.existsSync(file)) throw new Error("--apply needs a targets file");
  const report = readJson(file);
  const client = await connect({ write: true });
  try {
    const { rows } = await client.query(
      "select to_regclass('public.bank_location_fixes') as present",
    );
    if (!rows[0].present) {
      throw new Error(
        "bank_location_fixes doesn't exist: apply the migration first (npm run db:migrate)",
      );
    }
    // Row-level security refuses (rather than skips) an update to a confirmed fix, so
    // those banks are left out first.
    const confirmed = new Set(
      (
        await client.query(
          `select hospital_code from public.bank_location_fixes
           where reviewed_at is not null or method in ('manual', 'bank_confirmed')`,
        )
      ).rows.map((row) => row.hospital_code),
    );
    let written = 0;
    await client.query("begin");
    for (const fix of report.placements.filter((p) => !confirmed.has(p.hospitalCode))) {
      const result = await client.query(
        `insert into public.bank_location_fixes
           (hospital_code, state_code, latitude, longitude, reason, method, precision_m, evidence, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
         on conflict (hospital_code) do update set state_code = excluded.state_code,
           latitude = excluded.latitude, longitude = excluded.longitude, reason = excluded.reason,
           method = excluded.method, precision_m = excluded.precision_m,
           evidence = excluded.evidence, status = excluded.status, created_at = now()
         where bank_location_fixes.reviewed_at is null
           and bank_location_fixes.method not in ('manual', 'bank_confirmed')`,
        [
          fix.hospitalCode,
          fix.stateCode,
          fix.latitude,
          fix.longitude,
          fix.reason,
          fix.method,
          fix.precisionM,
          JSON.stringify({ ...fix.evidence, run: path.basename(file), name: fix.name }),
          fix.status,
        ],
      );
      written += result.rowCount;
    }
    await client.query("commit");
    console.log(
      `bank_location_fixes: ${written} of ${report.placements.length} written; ${confirmed.size} confirmed by a person left as they are`,
    );
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

try {
  if (mode === "control") await runControl();
  else if (mode === "targets") await runTargets();
  else await runApply();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
