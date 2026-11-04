import { haversineMeters } from "./geo.js";

// Pure helpers for scripts/place-banks.mjs, which finds positions for the banks
// location search can't place (docs/PLANS/plan_bank_locations.md, Part A). Kept here
// so they can be unit-tested; the app itself never geocodes banks.
//
// Precision comes before recall: a bank placed in the wrong town is worse than a bank
// not placed, because the ranking would send someone there (report 3, D3.2.2).

// Words that say nothing about which bank a name means, from report 3's matcher
// (../blood_data/scripts/validate_eraktkosh.py, D3.2.2), word for word.
export const GENERIC_WORDS = new Set(
  `blood bank banks centre center centres centers bb bc bsu the and of ltd pvt private
   limited unit storage component components separation facility hospital hospitals hosp
   general district dist civil sadar govt government medical college institute sciences
   science research charitable trust society voluntary memorial multi multispeciality
   speciality specialty super care health healthcare red cross indian ima nursing home clinic
   foundation regional state city new sri shri shree st dr mission rural urban community chc
   phc sub divisional taluk taluka referral base main a by run in at for ms m s hos bloodbank
   bloodcentre`.split(/\s+/),
);

// Every eRaktKosh name, with its blood-bank words, for searching. Storage units are
// usually named after the hospital they sit in ("BSU, CHC Foo"), and that hospital is
// what OpenStreetMap is likely to hold.
const BLOOD_BANK_WORDS =
  /\b(blood\s*(bank|cent(re|er)|storage\s*(unit|cent(re|er))|component\s*(separation\s*)?(unit|cent(re|er)))|b\.?\s*s\.?\s*u\.?|bsc)\b/gi;

/** @param {string | null | undefined} name */
export function searchName(name) {
  return String(name ?? "")
    .replace(BLOOD_BANK_WORDS, " ")
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s*[,;:/-]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "I.M.A." -> "ima", then split on anything that isn't a letter or digit.
/** @param {string | null | undefined} text */
export function nameWords(text) {
  const lower = String(text ?? "")
    .toLowerCase()
    .replace(/(?<=[a-z])\.(?=[a-z])/g, "")
    .replace(/\./g, "");
  return lower.split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * The words of a name that can identify a bank: not generic, not a place name, and at
 * least 3 letters.
 * @param {string} text
 * @param {Set<string>} placeWords
 */
export function distinctiveWords(text, placeWords = new Set()) {
  return new Set(
    nameWords(text).filter(
      (word) =>
        word.length >= 3 &&
        !/^\d+$/.test(word) &&
        !GENERIC_WORDS.has(word) &&
        !placeWords.has(word),
    ),
  );
}

/** Every word of the given place names, for leaving them out of name comparisons. */
export function placeWordsOf(...names) {
  return new Set(names.flatMap((name) => nameWords(name)).filter((word) => word.length >= 3));
}

/** Whether two names share a distinctive word. */
export function sharesDistinctiveWord(a, b, placeWords = new Set()) {
  const wordsA = distinctiveWords(a, placeWords);
  if (wordsA.size === 0) return false;
  return [...distinctiveWords(b, placeWords)].some((word) => wordsA.has(word));
}

// A six-digit Indian PIN code, possibly written "500 001". Word boundaries keep it
// from matching inside a phone number.
const PIN_PATTERN = /(?<![0-9])([1-9][0-9]{2})\s?([0-9]{3})(?![0-9])/g;

/**
 * The PIN code in an address: the last six-digit number starting 1 to 9, because
 * Indian addresses end with it. null when there is none.
 * @param {string | null | undefined} address
 */
export function extractPin(address) {
  const withoutPhones = String(address ?? "").replace(/(\+91[\s-]?)?[6-9][0-9]{9}/g, " ");
  const matches = [...withoutPhones.matchAll(PIN_PATTERN)];
  return matches.length === 0 ? null : matches.at(-1)[1] + matches.at(-1)[2];
}

/**
 * An address cleaned for a geocoder: phone numbers, e-mail addresses, the PIN and the
 * bank's own name removed, and repeated separators collapsed.
 * @param {string | null | undefined} address
 * @param {{ name?: string | null }} [options]
 */
export function cleanAddress(address, { name = null } = {}) {
  let text = String(address ?? "")
    .replace(/\S+@\S+/g, " ")
    .replace(/(\+91[\s-]?)?(\(?0[0-9]{2,4}\)?[\s-]?)?[0-9]{6,10}/g, " ")
    .replace(/\b(ph|phone|mob|mobile|tel|fax|email|e-mail|pin|pincode|pin code)\b\.?\s*:?/gi, " ");
  if (name) {
    const escaped = String(name)
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (escaped) text = text.replace(new RegExp(escaped, "gi"), " ");
  }
  return text
    .split(/[,\n]+/)
    .map((part) => part.replace(/\s+/g, " ").replace(/^[\s.,;:-]+|[\s.,;:-]+$/g, ""))
    .filter((part) => part.length > 1)
    .join(", ");
}

/**
 * The structured parts of an address for Nominatim: the town is the last part that is
 * neither the state, the district nor "India", and the street is what comes before it.
 * @param {string} cleanedAddress from cleanAddress
 * @param {{ stateName?: string | null, districtName?: string | null }} context
 */
export function addressParts(cleanedAddress, { stateName = null, districtName = null } = {}) {
  const skip = placeWordsOf(stateName ?? "", "india", "dist", "district");
  const isRegion = (part) => {
    const words = nameWords(part).filter((word) => !/^\d+$/.test(word));
    return words.length === 0 || words.every((word) => skip.has(word));
  };
  const parts = cleanedAddress
    .split(/,\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  while (parts.length > 0 && isRegion(parts.at(-1))) parts.pop();
  const districtWords = placeWordsOf(districtName ?? "");
  // "Dist. Pune" or "Pune District" as the last part is the district, not the town.
  if (
    parts.length > 1 &&
    nameWords(parts.at(-1)).every((word) => districtWords.has(word) || skip.has(word))
  ) {
    parts.pop();
  }
  const city = parts.length > 0 ? parts.at(-1) : null;
  const street = parts.length > 1 ? parts.slice(0, -1).join(", ") : null;
  return { street, city };
}

// What a result is, from Nominatim's jsonv2 fields.
/** @param {any} result */
export const isHealthFacility = (result) =>
  (result?.category === "amenity" && ["hospital", "clinic", "doctors"].includes(result?.type)) ||
  result?.category === "healthcare" ||
  (result?.category === "building" && result?.type === "hospital");
// Street or building level: what a bank's position needs (place_rank 26 and above).
/** @param {any} result */
export const isSpecific = (result) => Number(result?.place_rank) >= 26;
/** @param {any} result */
export const isPostcode = (result) =>
  result?.addresstype === "postcode" || result?.type === "postcode";

/**
 * The bounding box of a state outline (assets/state_boundaries.json) as Nominatim's
 * viewbox, "west,north,east,south".
 * @param {{ bbox: number[] }} state
 */
export const stateViewbox = (state) => {
  const [west, south, east, north] = state.bbox;
  return `${west},${north},${east},${south}`;
};

/**
 * Points that 3 or more other banks also landed on: a geocoder falling back to a
 * town's centre for every address it can't parse. Keys are points rounded to about
 * 10 m.
 * @param {{ latitude: number, longitude: number }[]} positions
 * @param {{ minOthers?: number }} [options]
 */
export function centroidTraps(positions, { minOthers = 3 } = {}) {
  const counts = new Map();
  for (const position of positions) {
    const key = pointKey(position);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > minOthers).map(([key]) => key));
}
export const pointKey = ({ latitude, longitude }) =>
  `${Number(latitude).toFixed(4)},${Number(longitude).toFixed(4)}`;

/**
 * The value at fraction p (0 to 1) of sorted values, interpolated linearly.
 * @param {number[]} sortedValues
 * @param {number} p
 */
export function quantile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const position = (sortedValues.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (position - lower);
}

// More than this far from the truth is a false match.
export const FALSE_MATCH_M = 10_000;
// The acceptance rule, fixed before the control results are seen (Part A): a step's
// positions go into location search automatically only if 90% are within 2 km and
// no more than 2% are false matches. Otherwise they go to the review queue.
export const ACCEPT_P90_M = 2_000;
export const ACCEPT_FALSE_MATCH_RATE = 0.02;

/**
 * How accurate one step was on the control banks.
 * @param {number[]} errorsM the error of every position the step gave
 * @param {number} banksTried
 */
export function accuracyOf(errorsM, banksTried) {
  const sorted = [...errorsM].sort((a, b) => a - b);
  const share = (limitM) =>
    sorted.length === 0 ? null : sorted.filter((e) => e <= limitM).length / sorted.length;
  const falseMatches = sorted.filter((error) => error > FALSE_MATCH_M).length;
  const stats = {
    banksTried,
    placed: sorted.length,
    yield: banksTried === 0 ? null : sorted.length / banksTried,
    medianM: quantile(sorted, 0.5),
    p90M: quantile(sorted, 0.9),
    within1Km: share(1_000),
    within2Km: share(2_000),
    within5Km: share(5_000),
    falseMatches,
    falseMatchRate: sorted.length === 0 ? null : falseMatches / sorted.length,
  };
  return { ...stats, accepted: meetsAcceptance(stats) };
}

/** Whether a step's measured accuracy lets its positions in automatically. */
export const meetsAcceptance = ({ placed, p90M, falseMatchRate }) =>
  placed > 0 && p90M <= ACCEPT_P90_M && falseMatchRate <= ACCEPT_FALSE_MATCH_RATE;

/**
 * Error in metres between a found position and the truth.
 * @param {{ latitude: number, longitude: number }} found
 * @param {{ latitude: number, longitude: number }} truth
 */
export const errorMeters = (found, truth) => haversineMeters(found, truth);

/**
 * A deterministic shuffle (mulberry32), so a sample can be drawn again.
 * @template T
 * @param {T[]} items
 * @param {number} seed
 * @returns {T[]}
 */
export function seededShuffle(items, seed) {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return shuffled;
}
