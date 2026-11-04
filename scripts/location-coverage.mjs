// How many stocked banks location search can see, and what that changes for real
// searches (#33, #34; docs/PLANS/plan_bank_locations.md, Part D).
//
//   node scripts/location-coverage.mjs
//       Saves a snapshot of the stock store (read-only) and measures it as it is:
//       ../blood_data/measurements/locations/snapshot_<date>.json and before/.
//   node scripts/location-coverage.mjs --snapshot <file> --placements <targets file>
//       Replays that same snapshot with the placements as accepted fixes, next to the
//       snapshot without them, into after_<date>/. Only positions differ between the
//       two (decision L7). --include-proposed counts the review queue's positions
//       too, as an upper bound. --placements db takes the fixes accepted in
//       bank_location_fixes now instead of a file.
//   A fresh snapshot taken once fixes exist is measured into current_<date>/, so the
//   baseline in before/ is never overwritten.
//
// Measures: visibility by reason; packed red cells (all groups, and O-) held by
// visible banks; how far each newly placed bank is from the nearest bank that was
// visible before; and, at 16 probe points plus each newly placed bank, the ring and
// shortfall of a nearest-mode search for red cells and of ranked searches for O+ x 2
// and O- x 3, replaying src/lib/rings.js as /api/blood-search does, with straight-line
// distances as its saved-copy path has.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { haversineMeters } from "../src/lib/geo.js";
import { locationVisibility, toLocationFix } from "../src/lib/bankLocations.js";
import { createStateChecker } from "../src/lib/stateBounds.js";
import { nearestModeRing, rankedModeRing } from "../src/lib/rings.js";
import { isDormant, parseQuantities } from "../src/lib/stock.js";
import { quantile } from "../src/lib/bankPlacement.js";
import { PLACES } from "./ranking-sensitivity.mjs";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const OUT_DIR = path.join(APP_DIR, "../blood_data/measurements/locations");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const stateChecker = createStateChecker(
  readJson(path.join(APP_DIR, "assets/state_boundaries.json")),
);
const today = new Date().toISOString().slice(0, 10);

// As /api/blood-search.
const SEARCH_RADIUS_M = 150_000;
const DENSITY_RADIUS_M = 15_000;
const DENSE_AREA_MIN_BANKS = 10;
const RINGS_M = {
  urban: [5_000, 10_000, 15_000, 25_000],
  rural: [20_000, 50_000, 100_000, 150_000],
};
const RED_CELLS = "Packed Red Blood Cells";
const PROBES = [
  ...PLACES.map(([name, latitude, longitude]) => ({ name, latitude, longitude })),
  { name: "Saifai (rural)", latitude: 26.9608, longitude: 78.9621 },
  { name: "Panaji", latitude: 15.4909, longitude: 73.8278 },
  { name: "Satara", latitude: 17.6805, longitude: 74.0183 },
];
const CONNAUGHT_PLACE = { latitude: 28.6315, longitude: 77.2167 };
const SEARCHES = [
  { label: "red cells, nearest", group: null, units: null },
  { label: "O+ x 2", group: "O+Ve", units: 2 },
  { label: "O- x 3", group: "O-Ve", units: 3 },
];

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

// ── the snapshot ─────────────────────────────────────────────────────────────

async function takeSnapshot() {
  process.loadEnvFile(path.join(APP_DIR, ".env.local"));
  const client = new pg.Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query("begin read only");
    const { rows: present } = await client.query(
      "select to_regclass('public.bank_location_fixes') is not null as present",
    );
    const fixesJoin = present[0].present
      ? `left join public.bank_location_fixes f on f.hospital_code = coalesce(s.hospital_code, b.hospital_code) and f.status = 'accepted'`
      : "";
    const fixColumns = present[0].present
      ? "f.latitude as fix_latitude, f.longitude as fix_longitude, f.method as fix_method, f.precision_m as fix_precision_m, f.reviewed_at as fix_reviewed_at"
      : "null as fix_latitude, null as fix_longitude, null as fix_method, null as fix_precision_m, null as fix_reviewed_at";
    const { rows } = await client.query(
      `select coalesce(s.hospital_code, b.hospital_code) as hospital_code,
         coalesce(s.state_code, b.state_code) as state_code,
         s.hospital_code is not null as has_stock,
         s.row->'components'->'${RED_CELLS}'->>'available_WithQty' as red_cells,
         s.row->>'entrydate' as entrydate,
         b.latitude, b.longitude,
         case when b.hospital_code is null or b.latitude is null then 'missing' else b.location_quality end as location_quality,
         ${fixColumns}
       from public.bank_stock_latest s
       full outer join public.blood_banks b on b.hospital_code = s.hospital_code
       ${fixesJoin}
       order by 1`,
    );
    const { rows: taken } = await client.query("select now() as at");
    return {
      takenAt: taken[0].at.toISOString(),
      fixesTable: present[0].present,
      banks: rows.map((row) => ({
        hospitalCode: row.hospital_code,
        stateCode: row.state_code,
        hasStock: row.has_stock,
        redCells: row.red_cells,
        entrydate: row.entrydate,
        latitude: row.latitude === null ? null : Number(row.latitude),
        longitude: row.longitude === null ? null : Number(row.longitude),
        locationQuality: row.location_quality,
        fix:
          row.fix_latitude === null
            ? null
            : {
                latitude: Number(row.fix_latitude),
                longitude: Number(row.fix_longitude),
                method: row.fix_method,
                precisionM: row.fix_precision_m,
                reviewedAt: row.fix_reviewed_at,
              },
      })),
    };
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
}

// ── one scenario ─────────────────────────────────────────────────────────────

const redCellUnits = (bank, group = null) =>
  parseQuantities(bank.redCells ?? "")
    .filter((entry) => group === null || entry.group === group)
    .reduce((sum, entry) => sum + entry.units, 0);

// The banks location search can see, with their positions, given a set of fixes:
// [{ ...bank, position, source }].
function visibleBanks(snapshot, fixes) {
  const fixesByCode = new Map(fixes.map((fix) => [fix.hospitalCode, fix]));
  const visible = [];
  const visibility = {};
  for (const bank of snapshot.banks) {
    const fix = fixesByCode.get(bank.hospitalCode);
    const own = { latitude: bank.latitude, longitude: bank.longitude, stateCode: bank.stateCode };
    // A fix applies as in src/lib/bankLocations.js: confirmed, or eRaktKosh's point unusable.
    const ownProblem =
      bank.latitude === null ||
      ["wrong_state", "outside_india", "missing"].includes(bank.locationQuality)
        ? (bank.locationQuality ?? "missing")
        : null;
    const hasFix = Boolean(fix && (fix.isConfirmed || ownProblem !== null));
    const status = locationVisibility({ ...own, locationQuality: bank.locationQuality, hasFix });
    if (bank.hasStock) visibility[status] = (visibility[status] ?? 0) + 1;
    if (status === "fixed") visible.push({ ...bank, position: fix, source: "fixed" });
    else if (status === "eraktkosh" && stateChecker.locationProblem(own) === null)
      visible.push({ ...bank, position: own, source: "eraktkosh" });
  }
  return { visible, visibility };
}

// A replay of one search at a probe point.
function replaySearch(visible, probe, search, now) {
  const near = visible
    .map((bank) => ({ ...bank, distanceM: haversineMeters(probe, bank.position) }))
    .filter((bank) => bank.distanceM <= SEARCH_RADIUS_M);
  const density = near.filter((bank) => bank.distanceM <= DENSITY_RADIUS_M).length;
  const area = density > DENSE_AREA_MIN_BANKS ? "urban" : "rural";
  const rings = RINGS_M[area];
  const candidates = near
    .filter((bank) => bank.hasStock && bank.distanceM <= rings.at(-1))
    .map((bank) => ({
      distanceM: bank.distanceM,
      isDormant: isDormant(bank.entrydate, now),
      units: redCellUnits(bank, search.group),
      source: bank.source,
    }))
    .filter((bank) => bank.units > 0);
  if (search.units === null) {
    const ringM = nearestModeRing(rings, candidates);
    return {
      area,
      ringM,
      banks: candidates.filter((b) => ringM !== null && b.distanceM <= ringM).length,
    };
  }
  const ringM = rankedModeRing(rings, candidates, search.units);
  const activeUnits = candidates
    .filter((bank) => ringM !== null && bank.distanceM <= ringM && !bank.isDormant)
    .reduce((sum, bank) => sum + bank.units, 0);
  return {
    area,
    ringM,
    activeUnits,
    shortfall: ringM === null || activeUnits < search.units,
    usesFixed: candidates.some(
      (b) => b.source === "fixed" && ringM !== null && b.distanceM <= ringM,
    ),
  };
}

function measure(snapshot, fixes, probes) {
  const now = new Date(snapshot.takenAt);
  const { visible, visibility } = visibleBanks(snapshot, fixes);
  const stocked = snapshot.banks.filter((bank) => bank.hasStock);
  const visibleStocked = visible.filter((bank) => bank.hasStock);
  const sumUnits = (banks, group) =>
    banks.reduce((sum, bank) => sum + redCellUnits(bank, group), 0);
  const delhi = snapshot.banks.filter(
    (bank) =>
      bank.locationQuality === "wrong_state" &&
      bank.latitude !== null &&
      haversineMeters(CONNAUGHT_PLACE, bank) <= 25_000 &&
      !visible.some((v) => v.hospitalCode === bank.hospitalCode),
  ).length;
  const probesOut = probes.map((probe) => ({
    name: probe.name,
    searches: Object.fromEntries(
      SEARCHES.map((s) => [s.label, replaySearch(visible, probe, s, now)]),
    ),
  }));
  const rings = probesOut
    .map((p) => p.searches["red cells, nearest"].ringM)
    .filter((r) => r !== null);
  return {
    stockedBanks: stocked.length,
    visibleStocked: visibleStocked.length,
    visibility,
    redCells: { all: sumUnits(stocked, null), visible: sumUnits(visibleStocked, null) },
    oNegative: { all: sumUnits(stocked, "O-Ve"), visible: sumUnits(visibleStocked, "O-Ve") },
    delhiMisplacedWithin25Km: delhi,
    probes: probesOut,
    summary: {
      shortfallsONeg3: probesOut.filter((p) => p.searches["O- x 3"].shortfall).length,
      shortfallsOPos2: probesOut.filter((p) => p.searches["O+ x 2"].shortfall).length,
      medianNearestRingKm: rings.length
        ? quantile(
            [...rings].sort((a, b) => a - b),
            0.5,
          ) / 1000
        : null,
    },
    visibleCodes: new Set(visible.map((bank) => bank.hospitalCode)),
    visible,
  };
}

// ── report ───────────────────────────────────────────────────────────────────

const pct = (part, whole) => (whole ? `${((100 * part) / whole).toFixed(1)}%` : "—");
const plain = ({ visibleCodes, visible, ...rest }) => rest;

function tableRows(before, after) {
  const row = (label, a, b) =>
    `| ${label} | ${a} | ${b ?? ""} | ${b === undefined ? "" : typeof a === "number" && typeof b === "number" ? (b - a >= 0 ? `+${b - a}` : b - a) : ""} |`;
  const share = (m) => `${m.visibleStocked} (${pct(m.visibleStocked, m.stockedBanks)})`;
  return [
    "| Measure | Before | After | Change |",
    "|---|---|---|---|",
    `| Stocked banks visible to location search | ${share(before)} | ${after ? share(after) : ""} | ${after ? `+${after.visibleStocked - before.visibleStocked}` : ""} |`,
    row(
      "No coordinates",
      before.visibility.missing ?? 0,
      after ? (after.visibility.missing ?? 0) : undefined,
    ),
    row(
      "Wrong state or outside India (with stock)",
      (before.visibility.wrong_state ?? 0) + (before.visibility.outside_india ?? 0),
      after
        ? (after.visibility.wrong_state ?? 0) + (after.visibility.outside_india ?? 0)
        : undefined,
    ),
    row(
      "Placed by a fix",
      before.visibility.fixed ?? 0,
      after ? (after.visibility.fixed ?? 0) : undefined,
    ),
    row("Packed red cells visible (units)", before.redCells.visible, after?.redCells.visible),
    row("O- packed red cells visible (units)", before.oNegative.visible, after?.oNegative.visible),
    row(
      `Probe searches for O- x 3 ending in a shortfall (of ${before.probes.length})`,
      before.summary.shortfallsONeg3,
      after?.summary.shortfallsONeg3,
    ),
    row(
      `Probe searches for O+ x 2 ending in a shortfall (of ${before.probes.length})`,
      before.summary.shortfallsOPos2,
      after?.summary.shortfallsOPos2,
    ),
    `| Median ring radius, nearest-mode red cells (km) | ${before.summary.medianNearestRingKm} | ${after?.summary.medianNearestRingKm ?? ""} | |`,
    row(
      "Central Delhi: misplaced banks within 25 km",
      before.delhiMisplacedWithin25Km,
      after?.delhiMisplacedWithin25Km,
    ),
  ];
}

// The accepted rows of bank_location_fixes, read-only.
async function readAcceptedFixes() {
  process.loadEnvFile(path.join(APP_DIR, ".env.local"));
  const client = new pg.Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query("begin read only");
    const { rows } = await client.query(
      `select hospital_code, state_code, latitude, longitude, method, precision_m, reviewed_at
       from public.bank_location_fixes where status = 'accepted'`,
    );
    return rows;
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
}

async function main() {
  const snapshotFile = option("--snapshot");
  const placementsFile = option("--placements");
  let snapshot;
  if (snapshotFile) snapshot = readJson(snapshotFile);
  else {
    snapshot = await takeSnapshot();
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, `snapshot_${today}.json`);
    fs.writeFileSync(file, JSON.stringify(snapshot));
    console.log(
      `snapshot: ${snapshot.banks.length} banks, taken ${snapshot.takenAt} -> ${path.relative(APP_DIR, file)}`,
    );
  }
  const storedFixes = snapshot.banks
    .filter((bank) => bank.fix)
    .map((bank) => ({
      hospitalCode: bank.hospitalCode,
      stateCode: bank.stateCode,
      ...bank.fix,
      isConfirmed:
        Boolean(bank.fix.reviewedAt) || ["manual", "bank_confirmed"].includes(bank.fix.method),
    }));

  let placedFixes = null;
  let placedCodes = [];
  if (placementsFile === "db") {
    // The fixes accepted in bank_location_fixes now, replayed on the given snapshot.
    placedFixes = (await readAcceptedFixes()).map(toLocationFix).filter(Boolean);
    placedCodes = placedFixes.map((fix) => fix.hospitalCode);
  } else if (placementsFile) {
    const report = readJson(placementsFile);
    const statuses = args.includes("--include-proposed") ? ["accepted", "proposed"] : ["accepted"];
    placedFixes = report.placements
      .filter((placement) => statuses.includes(placement.status))
      .map((placement) =>
        toLocationFix({
          hospital_code: placement.hospitalCode,
          state_code: placement.stateCode,
          latitude: placement.latitude,
          longitude: placement.longitude,
          method: placement.method,
          precision_m: placement.precisionM,
        }),
      )
      .filter(Boolean);
    placedCodes = placedFixes.map((fix) => fix.hospitalCode);
  }

  // The same probes for both runs: the fixed points, plus each newly placed bank.
  const probes = [
    ...PROBES,
    ...(placedFixes ?? []).map((fix) => ({
      name: `placed bank ${fix.hospitalCode}`,
      latitude: fix.latitude,
      longitude: fix.longitude,
    })),
  ];
  const before = measure(snapshot, storedFixes, probes);
  const after = placedFixes ? measure(snapshot, [...storedFixes, ...placedFixes], probes) : null;

  // How far patients near the newly placed banks used to have to look.
  let gap = null;
  if (after) {
    const beforeVisible = before.visible;
    const distances = after.visible
      .filter((bank) => !before.visibleCodes.has(bank.hospitalCode) && bank.hasStock)
      .map((bank) =>
        Math.min(
          ...beforeVisible
            .filter((b) => b.hasStock)
            .map((b) => haversineMeters(bank.position, b.position)),
        ),
      )
      .sort((a, b) => a - b);
    gap = {
      newlyVisible: distances.length,
      medianKm: distances.length ? quantile(distances, 0.5) / 1000 : null,
      p90Km: distances.length ? quantile(distances, 0.9) / 1000 : null,
      over10Km: distances.filter((d) => d > 10_000).length,
      over25Km: distances.filter((d) => d > 25_000).length,
    };
  }

  // A fresh snapshot that already has fixes is today's state, not the baseline, so it
  // never overwrites before/.
  const dir = path.join(
    OUT_DIR,
    after ? `after_${today}` : storedFixes.length > 0 ? `current_${today}` : "before",
  );
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "summary.json"),
    JSON.stringify(
      {
        snapshotTakenAt: snapshot.takenAt,
        placements: placementsFile ? path.basename(placementsFile) : null,
        includeProposed: args.includes("--include-proposed"),
        placedBanks: placedCodes.length,
        before: plain(before),
        after: after ? plain(after) : null,
        gap,
      },
      null,
      1,
    ),
  );
  const lines = [
    `# Location search coverage${after ? ": before and after" : ""}, snapshot of ${snapshot.takenAt.slice(0, 16).replace("T", " ")} UTC`,
    "",
    after
      ? `The same snapshot replayed with and without ${placedCodes.length} placements from \`${path.basename(placementsFile)}\`${args.includes("--include-proposed") ? " (accepted and proposed)" : " (accepted only)"}.`
      : "The stock store as it is. Probe searches replay src/lib/rings.js at 16 places with straight-line distances.",
    "",
    ...tableRows(before, after),
  ];
  if (gap) {
    lines.push(
      "",
      `**Gap closed:** ${gap.newlyVisible} newly visible stocked banks. The nearest bank that was visible before is a median of ${gap.medianKm?.toFixed(1)} km from them (p90 ${gap.p90Km?.toFixed(1)} km); ${gap.over10Km} were more than 10 km from any, and ${gap.over25Km} more than 25 km.`,
    );
  }
  fs.writeFileSync(path.join(dir, "summary.md"), `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
  console.log(`\nsaved ${path.relative(APP_DIR, dir)}/summary.json and .md`);
}

await main();
