import { isInIndia } from "@/lib/geo";

// The donor network's notice, its whitelists and its validators (phase 1). Pure, so the
// card, the route and the tests share them. When the notice text changes, change the
// version: everyone who joined under an older one is asked again.
export const DONOR_NETWORK_NOTICE_VERSION = "2026-11-17";

// What the card shows before someone joins. Informational: the blood centre's medical
// officer makes the final call on whether a person may donate.
export const DONOR_NETWORK_NOTICE_POINTS = [
  "The network is anchored to licensed blood centres. A centre asks, and the blood centre's medical officer makes the final call on whether you may donate.",
  "Nobody is messaged in this phase, and no one outside bloodLink sees you as an individual.",
  "bloodLink stores your consent and the notice version, up to two areas of about 1 km (never your address), your availability and quiet hours, and the dates your eligibility window covers. Your screening answers are never shown to anyone else.",
  "Admins see only counts per area of about 1 km, and areas with fewer than 5 donors are hidden.",
  "You can withdraw at any time. Your areas and settings are deleted at once.",
];

export const AREA_KINDS = ["home", "work"];
// In-app and push can be chosen now; email and SMS come later.
export const CHANNELS = ["in_app", "push", "email", "sms"];
export const SELECTABLE_CHANNELS = ["in_app", "push"];
export const DEFAULT_SETTINGS = {
  isAvailable: true,
  snoozedUntil: null,
  quietStart: "22:00",
  quietEnd: "07:00",
  criticalOverridesQuiet: false,
  criticalOverridesGap: false,
  maxRequestsPerWeek: 2,
  apheresisWilling: false,
  channels: ["in_app", "push"],
};

const SNOOZE_LIMIT_DAYS = 30;
const DAY_MS = 86_400_000;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// A cell is 0.01 degrees, about 1 km. The browser rounds before sending and the server
// rounds again, so an exact position never reaches the database.
export const roundCell = (value) => Number(Number(value).toFixed(2));

// The database returns time as "22:00:00"; the form and the API use "22:00".
export function toClockTime(value) {
  return typeof value === "string" ? value.slice(0, 5) : value;
}

// Returns { settings, errors }. Unknown keys are dropped; every field is required.
export function sanitizeDonorSettings(input, now = new Date()) {
  const errors = [];
  const isObject = input && typeof input === "object" && !Array.isArray(input);
  const raw = isObject ? input : {};
  if (!isObject) errors.push("Settings are missing.");

  const booleans = {};
  for (const [key, label] of [
    ["isAvailable", "Availability"],
    ["criticalOverridesQuiet", "The quiet hours override"],
    ["criticalOverridesGap", "The donation gap override"],
    ["apheresisWilling", "The apheresis choice"],
  ]) {
    if (typeof raw[key] === "boolean") booleans[key] = raw[key];
    else errors.push(`${label} must be yes or no.`);
  }

  const quiet = {};
  for (const [key, label] of [
    ["quietStart", "Quiet hours start"],
    ["quietEnd", "Quiet hours end"],
  ]) {
    if (typeof raw[key] === "string" && TIME_PATTERN.test(raw[key])) quiet[key] = raw[key];
    else errors.push(`${label} must be a time such as 22:00.`);
  }

  let maxRequestsPerWeek = raw.maxRequestsPerWeek;
  if (!Number.isInteger(maxRequestsPerWeek) || maxRequestsPerWeek < 1 || maxRequestsPerWeek > 7) {
    errors.push("Requests a week must be a whole number from 1 to 7.");
    maxRequestsPerWeek = null;
  }

  let channels = raw.channels;
  if (
    !Array.isArray(channels) ||
    channels.length === 0 ||
    channels.some((channel) => !CHANNELS.includes(channel))
  ) {
    errors.push("Choose at least one channel from in-app, push, email or SMS.");
    channels = null;
  } else {
    channels = CHANNELS.filter((channel) => channels.includes(channel));
  }

  let snoozedUntil = null;
  if (raw.snoozedUntil !== null && raw.snoozedUntil !== undefined) {
    const time = typeof raw.snoozedUntil === "string" ? Date.parse(raw.snoozedUntil) : NaN;
    if (Number.isNaN(time) || time > now.getTime() + SNOOZE_LIMIT_DAYS * DAY_MS) {
      errors.push(`A snooze can last at most ${SNOOZE_LIMIT_DAYS} days.`);
    } else {
      snoozedUntil = new Date(time).toISOString();
    }
  }

  return {
    settings: { ...booleans, ...quiet, maxRequestsPerWeek, channels, snoozedUntil },
    errors,
  };
}

// Returns { areas, errors }: at most one home and one work area, each rounded to a cell
// and inside India.
export function sanitizeDonorAreas(input) {
  const errors = [];
  if (!Array.isArray(input)) return { areas: [], errors: ["Areas must be a list."] };
  if (input.length > AREA_KINDS.length) {
    return { areas: [], errors: ["You can save at most two areas, home and work."] };
  }
  const areas = [];
  for (const item of input) {
    const kind = item?.kind;
    if (!AREA_KINDS.includes(kind)) {
      errors.push("An area must be home or work.");
      continue;
    }
    if (areas.some((area) => area.kind === kind)) {
      errors.push(`There can be only one ${kind} area.`);
      continue;
    }
    if (typeof item.latitude !== "number" || typeof item.longitude !== "number") {
      errors.push(`The ${kind} area needs a latitude and a longitude.`);
      continue;
    }
    const latitude = roundCell(item.latitude);
    const longitude = roundCell(item.longitude);
    if (!isInIndia({ latitude, longitude })) {
      errors.push(`The ${kind} area must be inside India.`);
      continue;
    }
    areas.push({ kind, latitude, longitude });
  }
  return { areas: errors.length === 0 ? areas : [], errors };
}
