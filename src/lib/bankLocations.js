import { haversineMeters } from "./geo.js";

// Corrected bank positions (#33, #34; docs/SUMMARIES/data_quality.md, "Bank locations in full", Part C).
// eRaktKosh's nearest call gives no position for some stocked banks and a wrong one
// for others, so location search can't see them. bank_location_fixes holds positions
// found for them, and applyLocationFixes merges the accepted ones into a nearest
// answer, before the route's own state check. Pure, so tests and scripts can use it.
//
// Which position wins (decision L6):
// - a fix a person confirmed always wins: one they placed (manual), one the bank
//   confirmed (bank_confirmed), or a machine fix an admin reviewed and accepted;
// - any other machine fix applies only while eRaktKosh's own point is unusable
//   (missing, wrong_state or outside_india). When eRaktKosh corrects a bank, its
//   point wins, and the weekly directory run marks the fix superseded.

export const HUMAN_METHODS = new Set(["manual", "bank_confirmed"]);
export const MACHINE_METHODS = new Set([
  "eraktkosh_other",
  "datagov",
  "nominatim_name",
  "nominatim_address",
  "pincode",
]);
export const FIX_METHODS = [...MACHINE_METHODS, ...HUMAN_METHODS];
export const METHOD_LABELS = {
  eraktkosh_other: "another eRaktKosh call",
  datagov: "the data.gov.in directory",
  nominatim_name: "OpenStreetMap, by name",
  nominatim_address: "OpenStreetMap, by address",
  pincode: "the PIN code's centre",
  manual: "placed by an admin",
  bank_confirmed: "confirmed by the bank",
};
export const REASON_LABELS = {
  missing: "eRaktKosh gives no position",
  wrong_state: "eRaktKosh places it in another state",
  outside_india: "eRaktKosh places it outside India",
  shared: "eRaktKosh gives it a point shared with other banks",
  corrected: "an admin corrected eRaktKosh's position",
};
// The decisions /admin/locations offers, as review_bank_location() takes them.
export const REVIEW_DECISIONS = ["accepted", "moved", "rejected", "cant_place"];
// The pages show the error radius only when it is more than this.
export const SHOWN_PRECISION_M = 500;

/**
 * A bank_location_fixes row from the Data API -> the shape the search merges, or
 * null when the row can't be used.
 * @param {any} row
 */
export function toLocationFix(row) {
  const latitude = Number(row?.latitude);
  const longitude = Number(row?.longitude);
  const hospitalCode = String(row?.hospital_code ?? "");
  if (!/^[0-9]{1,10}$/.test(hospitalCode) || !Number.isFinite(latitude)) return null;
  if (!Number.isFinite(longitude) || !FIX_METHODS.includes(row.method)) return null;
  return {
    hospitalCode,
    stateCode: String(row.state_code),
    latitude,
    longitude,
    method: row.method,
    precisionM: Number(row.precision_m) || null,
    isConfirmed: HUMAN_METHODS.has(row.method) || Boolean(row.reviewed_at),
  };
}

/**
 * Merges accepted fixes into a nearest answer.
 * - A bank in the answer takes its fix's position when the fix is confirmed by a
 *   person, or when eRaktKosh's own point has a problem.
 * - A fixed bank the answer left out (no coordinates, or a wrong point far away) is
 *   added when its fix lies within the radius. Its name, address and phone come from
 *   its stock row later, as for every bank.
 * Moved and added banks carry locationSource "fixed" and locationPrecisionM; the
 * rest are returned unchanged. A moved bank whose fix is outside the radius is
 * dropped, as nearest would have left it out.
 * @param {any[]} nearbyBanks eRaktKosh nearest rows: { hospitalCode, stateCode, latitude, longitude, dist }
 * @param {ReturnType<typeof toLocationFix>[]} fixes accepted fixes
 * @param {{ origin: { latitude: number, longitude: number }, radiusM: number,
 *   stateChecker: { locationProblem: (bank: any) => string | null } }} context
 * @returns {{ banks: any[], relocated: number, added: number }}
 */
export function applyLocationFixes(nearbyBanks, fixes, { origin, radiusM, stateChecker }) {
  const fixesByCode = new Map(fixes.filter(Boolean).map((fix) => [fix.hospitalCode, fix]));
  if (fixesByCode.size === 0) return { banks: nearbyBanks, relocated: 0, added: 0 };

  const withFix = (bank, fix) => ({
    ...bank,
    latitude: fix.latitude,
    longitude: fix.longitude,
    dist: haversineMeters(origin, fix),
    locationSource: "fixed",
    locationPrecisionM: fix.precisionM,
  });
  const banks = [];
  const seenCodes = new Set();
  let relocated = 0;
  for (const bank of nearbyBanks) {
    const code = String(bank.hospitalCode);
    seenCodes.add(code);
    const fix = fixesByCode.get(code);
    const takesFix =
      fix &&
      (fix.isConfirmed ||
        HUMAN_METHODS.has(fix.method) ||
        stateChecker.locationProblem(bank) !== null);
    if (!takesFix) {
      banks.push(bank);
      continue;
    }
    const moved = withFix(bank, fix);
    if (moved.dist <= radiusM) {
      banks.push(moved);
      relocated += 1;
    }
  }
  let added = 0;
  for (const fix of fixesByCode.values()) {
    if (seenCodes.has(fix.hospitalCode)) continue;
    const bank = withFix(
      { hospitalCode: Number(fix.hospitalCode), stateCode: Number(fix.stateCode) },
      fix,
    );
    if (bank.dist <= radiusM) {
      banks.push(bank);
      added += 1;
    }
  }
  return { banks, relocated, added };
}

const UNUSABLE_QUALITIES = new Set(["missing", "wrong_state", "outside_india"]);

/**
 * One position per bank, for a region search's Directions link, which has no nearest
 * call to take it from. eRaktKosh's own point is used while it is usable; a fix a
 * person confirmed, or any accepted fix when the point is unusable, takes its place
 * (the rule of applyLocationFixes). A bank with no usable position is left out.
 * @param {{ hospital_code: string, latitude: number|null, longitude: number|null,
 *   location_quality?: string }[]} directoryRows blood_banks rows
 * @param {ReturnType<typeof toLocationFix>[]} fixes accepted fixes
 * @returns {Map<string, { latitude: number, longitude: number }>} by hospital code
 */
export function bankPositions(directoryRows, fixes) {
  const positions = new Map();
  for (const row of directoryRows) {
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    const hasPoint =
      row.latitude !== null &&
      row.longitude !== null &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude);
    if (hasPoint && !UNUSABLE_QUALITIES.has(row.location_quality)) {
      positions.set(String(row.hospital_code), { latitude, longitude });
    }
  }
  for (const fix of fixes.filter(Boolean)) {
    if (fix.isConfirmed || !positions.has(fix.hospitalCode)) {
      positions.set(fix.hospitalCode, { latitude: fix.latitude, longitude: fix.longitude });
    }
  }
  return positions;
}

/**
 * The accepted fixes that put a bank within radiusKm of a pin, among the banks the
 * pin's box query did not return. Their rows are fetched by code (#63).
 * @param {ReturnType<typeof toLocationFix>[]} fixes
 * @param {Set<string>} boxCodes hospital codes the box query returned
 * @param {{ latitude: number, longitude: number }} origin
 * @param {number} radiusKm
 */
export function fixCodesNearPin(fixes, boxCodes, origin, radiusKm) {
  return fixes
    .filter(Boolean)
    .filter((fix) => !boxCodes.has(fix.hospitalCode))
    .filter((fix) => haversineMeters(origin, fix) <= radiusKm * 1000)
    .map((fix) => fix.hospitalCode);
}

/**
 * The banks near a pin for donor suggestions, with corrected positions applied (#63),
 * by the same rules as location search: a fix wins when a person confirmed it or
 * when the bank's own point is unusable.
 * @param {{ hospitalCode: string, locationQuality?: string | null,
 *   latitude: number | null, longitude: number | null, stateCode?: string | null }[]} banks
 *   rows from blood_banks: those the pin's box returned, then any fixed bank fetched by code
 * @param {ReturnType<typeof toLocationFix>[]} fixes accepted fixes
 * @param {{ latitude: number, longitude: number }} origin
 * @param {number} radiusKm
 * @returns {any[]} the banks within radiusKm, each with distanceKm (to 0.1 km)
 */
export function suggestionBanksNearPin(banks, fixes, origin, radiusKm) {
  const radiusM = radiusKm * 1000;
  const known = new Set(banks.map((bank) => String(bank.hospitalCode)));
  const nearby = banks.map((bank) => {
    const hasPoint = Number.isFinite(Number(bank.latitude)) && bank.latitude !== null;
    return {
      ...bank,
      hospitalCode: String(bank.hospitalCode),
      locationProblem:
        UNUSABLE_QUALITIES.has(bank.locationQuality) || !hasPoint
          ? (bank.locationQuality ?? "missing")
          : null,
      dist: hasPoint ? haversineMeters(origin, bank) : Infinity,
    };
  });
  const { banks: merged } = applyLocationFixes(
    nearby,
    fixes.filter((fix) => fix && known.has(fix.hospitalCode)),
    { origin, radiusM, stateChecker: { locationProblem: (bank) => bank.locationProblem ?? null } },
  );
  return merged
    .filter(
      (bank) =>
        bank.locationSource === "fixed" || (bank.locationProblem === null && bank.dist <= radiusM),
    )
    .map((bank) => ({ ...bank, distanceKm: Math.round(bank.dist / 100) / 10 }));
}

// Whether the merge is on. BANK_LOCATION_FIXES=off skips it, for the paired
// before-and-after measurement (Part D) and as a one-line rollback.
export const locationFixesEnabled = (env = process.env) =>
  String(env.BANK_LOCATION_FIXES ?? "").toLowerCase() !== "off";

/**
 * What location search can do with a stocked bank, for the coverage measurement:
 * "fixed", "eraktkosh" (its own point is usable), or why it is hidden: "missing",
 * "wrong_state" or "outside_india". hasFix: whether an accepted fix applies to it,
 * by the rules above (confirmed by a person, or eRaktKosh's own point unusable).
 * @param {{ latitude?: any, longitude?: any, locationQuality?: string | null,
 *   hasFix?: boolean }} bank
 */
export function locationVisibility({ latitude, longitude, locationQuality, hasFix = false }) {
  if (hasFix) return "fixed";
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined)
    return "missing";
  if (["wrong_state", "outside_india", "missing"].includes(locationQuality)) {
    return locationQuality;
  }
  return "eraktkosh";
}
