// Reference implementation of the donor network's matching (docs/PLANS/plan_donor_network.md,
// "Matching logic", "Lifecycles"). Pure and deterministic: `now` is always a parameter, and the
// random tie-break takes an injected `random` function or a seed. The SQL `match_wave` (phase 2)
// is tested against this module, so every rule is written out here.

import { donorGroupsFor } from "./compatibility";
import { ETA_DECAY_MINUTES } from "./ranking";
import { URBAN_RINGS_KM, RURAL_RINGS_KM } from "./rings";
import { createTrafficModel } from "./trafficModel";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const IST_OFFSET_MS = 5.5 * MS_PER_HOUR;

// Step 3 defaults, all assumptions the simulation and the pilot will tune.
export const WAVE_SETTINGS = {
  critical: { gapMinutes: 10, maxWaves: 6, cap: 40, overbook: 1.5, minDonors: 3 },
  urgent: { gapMinutes: 30, maxWaves: 4, cap: 25, overbook: 1.5, minDonors: 3 },
  routine: { gapMinutes: 240, maxWaves: 3, cap: 25, overbook: 1.3, minDonors: 3 },
};

// Step 5 and step 1 rules 4, 5, 9.
export const REST_DAYS_FULL = 28;
export const MIN_GAP_HOURS = 72;
export const SCREENING_MAX_AGE_DAYS = 90;
export const MAX_RING_WAVE = 4; // the 5th and later waves reuse the widest ring
export const COMPATIBLE_FROM_WAVE = 3; // exact group only before this wave
export const GROUP_FIT = { exact: 1, compatible: 0.7 };
export const RINGS_KM = { urban: URBAN_RINGS_KM, rural: RURAL_RINGS_KM };

// Step 2's smoothing priors (assumptions): a new donor has respond 1/5 = 0.20, show 4/5 = 0.80.
export const PRIORS = {
  respond: { accepts: 1, asks: 5 },
  show: { shows: 4, accepts: 5 },
};

const settingsFor = (urgency) => WAVE_SETTINGS[urgency] ?? WAVE_SETTINGS.urgent;

// Float noise guard: 13 * 1.3 = 16.900000000000002 must not turn ceil(10 * 1.3) into 14.
const ceilClean = (value) => Math.ceil(Math.round(value * 1e9) / 1e9);

// ---------- rates and score (step 2) ----------

export function respondRate({ accepts = 0, asks = 0 } = {}) {
  return (accepts + PRIORS.respond.accepts) / (asks + PRIORS.respond.asks);
}

export function showRate({ shows = 0, accepts = 0 } = {}) {
  return (shows + PRIORS.show.shows) / (accepts + PRIORS.show.accepts);
}

export function pDonate(counts = {}) {
  return respondRate(counts) * showRate(counts);
}

// Straight-line km to minutes by road. The formula is trafficModel's (km x DETOUR_FACTOR / zone
// free-flow speed x (1 + congestion / 100) x rain factor), called through createTrafficModel
// with no profiles, because travelMinutes needs none; so the numbers are never copied.
// conditions: { freeFlowKmh, congestionPercent, rainFactor }. The request stores the zone's
// free-flow speed and the congestion and rain at raise time (trafficModel's trafficZone and
// trafficConditions produce all three), so the SQL side needs no profile file.
const { travelMinutes: modelTravelMinutes } = createTrafficModel({});
export function travelMinutes(km, { freeFlowKmh, congestionPercent = 0, rainFactor = 1 }) {
  return modelTravelMinutes(
    { straightLineM: km * 1000, leg: null },
    { freeFlowKmh },
    {
      congestionPercent,
      rainFactor,
    },
  );
}

// Fractional days since the donor was last asked; 1 (fully rested) when never asked.
export function restedFactor(lastAskedAt, now) {
  if (lastAskedAt === null || lastAskedAt === undefined) return 1;
  const days = Math.max(0, (new Date(now) - new Date(lastAskedAt)) / MS_PER_DAY);
  return Math.min(1, 0.5 + days / REST_DAYS_FULL);
}

// score = p_donate x e^(-minutes / tau) x rested x groupFit, 0 to 1.
export function donorScore({
  accepts = 0,
  asks = 0,
  shows = 0,
  minutes,
  urgency = "urgent",
  lastAskedAt = null,
  now,
  exact = true,
}) {
  const tau = ETA_DECAY_MINUTES[urgency] ?? ETA_DECAY_MINUTES.urgent;
  return (
    pDonate({ accepts, asks, shows }) *
    Math.exp(-minutes / tau) *
    restedFactor(lastAskedAt, now) *
    (exact ? GROUP_FIT.exact : GROUP_FIT.compatible)
  );
}

// ---------- waves (step 3) ----------

// Waves count from 1. Ring radius in km.
export function ringForWave(area, wave) {
  const rings = RINGS_KM[area === "rural" ? "rural" : "urban"];
  return rings[Math.min(Math.max(wave, 1), MAX_RING_WAVE) - 1];
}

// Donor groups for a wave: [{ code, name, exact }], exact first. Compatible ones only from
// wave 3 and only when the request allows them; donorGroupsFor honours the component and
// Bombay (Oh) donors only ever match Bombay.
export function groupsForWave(request, wave) {
  const exactOnly = !(request.allowCompatible === true && wave >= COMPATIBLE_FROM_WAVE);
  return donorGroupsFor(request.group, request.component, { exactOnly });
}

// Acceptances wanted in all: ceil(units left x overbook).
export function waveTarget(unitsLeft, urgency) {
  return ceilClean(Math.max(0, unitsLeft) * settingsFor(urgency).overbook);
}

// ceil(wanted / pAccept) clamped to [min, cap], then to the candidates there are.
export function waveSize({ wanted, pAccept, urgency, candidateCount }) {
  const { cap, minDonors } = settingsFor(urgency);
  const raw = ceilClean(wanted / pAccept);
  const clamped = Math.min(Math.max(raw, minDonors), cap);
  return Math.min(clamped, Math.max(0, candidateCount));
}

// ---------- quiet hours and snooze ----------

const toMinutes = (clock) => {
  const [hours, minutes] = String(clock).split(":");
  return Number(hours) * 60 + Number(minutes);
};

export const indiaDate = (now) =>
  new Date(new Date(now).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

const daysBetweenDates = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);

// Quiet hours on India's clock. Start after end means the window crosses midnight (22:00 to
// 07:00); start equal to end means no quiet hours. Start is inside, end is outside.
export function inQuietHours({ quietStart = "22:00", quietEnd = "07:00" } = {}, now) {
  const start = toMinutes(quietStart);
  const end = toMinutes(quietEnd);
  if (start === end) return false;
  const shifted = new Date(new Date(now).getTime() + IST_OFFSET_MS);
  const minute = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

export function isSnoozed({ snoozedUntil = null } = {}, now) {
  return (
    snoozedUntil !== null && snoozedUntil !== undefined && new Date(snoozedUntil) > new Date(now)
  );
}

// ---------- hard filters (step 1) ----------

// donor: { id, status: { isInNetwork, eligibleFrom, eligibleUntil, needsStaffCheck,
//   screeningConfirmedAt, bloodGroupCode, asksTotal, acceptsTotal, showsTotal },
//   settings: { isAvailable, snoozedUntil, quietStart, quietEnd, criticalOverridesQuiet,
//   criticalOverridesGap, maxRequestsPerWeek, apheresisWilling },
//   areas: [{ kind, distanceKm }] (km to the request's anchor, already computed),
//   asksLast7Days, lastAskedAt, alreadyAsked (rule 11) }
// request: { urgency, group, component, allowCompatible, isApheresis, neededBy, raisedBy, area }
// Returns { ok, failed: [rule numbers] }; every rule is checked, so a test sees all failures.
export function passesHardFilters(donor, request, wave, now) {
  const { status = {}, settings = {} } = donor;
  const failed = [];
  const isCritical = request.urgency === "critical";
  const today = indiaDate(now);

  if (status.isInNetwork !== true) failed.push(1);
  if (settings.isAvailable !== true || isSnoozed(settings, now)) failed.push(2);

  const groups = groupsForWave(request, wave);
  if (!groups.some((group) => group.code === String(status.bloodGroupCode))) failed.push(3);

  // Window [eligibleFrom, eligibleUntil] overlaps [today, neededBy], India dates. No neededBy
  // means open-ended.
  const neededByDate = request.neededBy ? indiaDate(request.neededBy) : null;
  const overlaps =
    status.eligibleFrom &&
    status.eligibleUntil &&
    status.eligibleFrom <= (neededByDate ?? "9999-12-31") &&
    status.eligibleUntil >= today;
  if (!overlaps) failed.push(4);

  const confirmedAge = status.screeningConfirmedAt
    ? daysBetweenDates(indiaDate(status.screeningConfirmedAt), today)
    : null;
  if (confirmedAge === null || confirmedAge > SCREENING_MAX_AGE_DAYS) failed.push(5);

  if (status.needsStaffCheck !== false) failed.push(6);
  if (request.isApheresis && settings.apheresisWilling !== true) failed.push(7);

  const ringKm = ringForWave(request.area, wave);
  if (!(donor.areas ?? []).some((area) => area.distanceKm <= ringKm)) failed.push(8);

  const gapSkipped = isCritical && settings.criticalOverridesGap === true;
  const gapOk =
    gapSkipped ||
    donor.lastAskedAt === null ||
    donor.lastAskedAt === undefined ||
    new Date(now) - new Date(donor.lastAskedAt) > MIN_GAP_HOURS * MS_PER_HOUR;
  if (!gapOk || (donor.asksLast7Days ?? 0) >= (settings.maxRequestsPerWeek ?? 2)) failed.push(9);

  const quietSkipped = isCritical && settings.criticalOverridesQuiet === true;
  if (!quietSkipped && inQuietHours(settings, now)) failed.push(10);

  if (donor.alreadyAsked === true) failed.push(11);
  if (request.raisedBy !== undefined && donor.id === request.raisedBy) failed.push(12);

  return { ok: failed.length === 0, failed };
}

// ---------- ordering ----------

// A small seeded generator (mulberry32) for the tie-break; the SQL side feeds the same draws.
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// planWave: which donors to ask, in order. Returns null when the request is past its last
// wave or wanted <= 0 (covered). With no candidates the wave is still returned, with an empty
// asks list: the wave counts, so the next one widens the ring.
// request adds: unitsNeeded, unitsDonated, wavesSent, acceptedOnHold, conditions
// ({ freeFlowKmh, congestionPercent, rainFactor }).
// options: { random } (a function returning [0, 1)) or { seed }; Math.random is no default
// for tests, only for production callers that pass nothing.
export function planWave(request, donors, now, options = {}) {
  const { maxWaves, cap, minDonors } = settingsFor(request.urgency);
  const wave = (request.wavesSent ?? 0) + 1;
  if (wave > maxWaves) return null;
  const unitsLeft = request.unitsNeeded - (request.unitsDonated ?? 0);
  const target = waveTarget(unitsLeft, request.urgency);
  const wanted = target - (request.acceptedOnHold ?? 0);
  if (wanted <= 0) return null;

  const ringKm = ringForWave(request.area, wave);
  const groups = groupsForWave(request, wave);
  const exactCodes = new Set(groups.filter((group) => group.exact).map((group) => group.code));
  const random =
    options.random ?? (options.seed !== undefined ? seededRandom(options.seed) : Math.random);

  // Draw one tie-break key per donor in a fixed (id) order so a seed gives one answer.
  const inIdOrder = [...donors].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const candidates = [];
  for (const donor of inIdOrder) {
    const tieKey = random();
    if (!passesHardFilters(donor, request, wave, now).ok) continue;
    const nearestKm = Math.min(
      ...donor.areas.filter((area) => area.distanceKm <= ringKm).map((area) => area.distanceKm),
    );
    const minutes = travelMinutes(nearestKm, request.conditions);
    const { asksTotal = 0, acceptsTotal = 0, showsTotal = 0 } = donor.status;
    const counts = { asks: asksTotal, accepts: acceptsTotal, shows: showsTotal };
    candidates.push({
      donorId: donor.id,
      score: donorScore({
        ...counts,
        minutes,
        urgency: request.urgency,
        lastAskedAt: donor.lastAskedAt ?? null,
        now,
        exact: exactCodes.has(String(donor.status.bloodGroupCode)),
      }),
      estMinutes: minutes,
      exact: exactCodes.has(String(donor.status.bloodGroupCode)),
      respond: respondRate({ accepts: acceptsTotal, asks: asksTotal }),
      tieKey,
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.tieKey - b.tieKey);

  // pAccept: mean respond of the top k0 = min(CAP, candidates); the prior when none.
  const top = candidates.slice(0, Math.min(cap, candidates.length));
  const pAccept = top.length
    ? top.reduce((sum, candidate) => sum + candidate.respond, 0) / top.length
    : respondRate({});
  const k = waveSize({
    wanted,
    pAccept,
    urgency: request.urgency,
    candidateCount: candidates.length,
  });

  return {
    wave,
    ringKm,
    target,
    wanted,
    pAccept,
    k,
    minDonors,
    candidateCount: candidates.length,
    nextWaveAt: new Date(
      new Date(now).getTime() + settingsFor(request.urgency).gapMinutes * MS_PER_MINUTE,
    ),
    asks: candidates.slice(0, k).map(({ donorId, score, estMinutes, exact }) => ({
      donorId,
      score,
      estMinutes,
      exact,
    })),
  };
}

// ---------- stop rules (step 4, lifecycle) ----------

// request: { status, unitsNeeded, unitsDonated, acceptedOnHold, wavesSent, urgency, neededBy,
// nextWaveAt }. Returns the status after this minute's advance. Cancelling is explicit (done by
// the raising organization), so this never returns "cancelled"; a final status is kept as is.
export function nextRequestStatus(request, now) {
  const final = ["fulfilled", "partly_fulfilled", "expired", "cancelled"];
  if (final.includes(request.status)) return request.status;
  const { maxWaves } = settingsFor(request.urgency);
  const donated = request.unitsDonated ?? 0;
  const unitsLeft = request.unitsNeeded - donated;

  if (unitsLeft <= 0) return "fulfilled";

  const endState = donated > 0 ? "partly_fulfilled" : "expired";
  if (request.neededBy && new Date(now) >= new Date(request.neededBy)) return endState;

  const isCovered = (request.acceptedOnHold ?? 0) >= waveTarget(unitsLeft, request.urgency);
  if (isCovered) return "covered";

  // Open (or back to open): after the last wave plus one gap, with nothing more to send.
  const lastWaveDone = (request.wavesSent ?? 0) >= maxWaves;
  if (lastWaveDone && request.nextWaveAt && new Date(now) >= new Date(request.nextWaveAt)) {
    return endState;
  }
  return "open";
}
