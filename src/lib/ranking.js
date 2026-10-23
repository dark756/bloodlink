// The ".js" lets Node scripts (scripts/ranking-sensitivity.mjs) import this file too.
import { parseEntryDate } from "./stock.js";

// Emergency blood-source ranking.
//
// Only banks that list the patient's exact blood group are ranked. Compatible
// substitute groups are not counted. Each bank gets four scores from 0 to 100:
//   eta        100 * e^(-minutes / tau): falls as travel time grows; tau is
//              shorter for more urgent requests. etaMinutes is set beforehand by
//              src/lib/traffic.js (OSRM road route, time of day, area, rain).
//   coverage   100 * min(1, units / units needed)
//   surplus    100 * (1 - e^(-spare / units needed)), where spare is the units
//              beyond the request: one request's worth spare scores 63, two
//              score 86. Spare stock is a buffer against stock that changed
//              since the bank last updated it, and against the patient needing
//              more, so it is weighted more for critical and urgent requests.
//   freshness  100 when stock was updated within 6 h, falling linearly to 0
//              at 72 h; 30 when the bank gives no update time
// The total is a weighted sum; weights depend on urgency (they add up to 1).
//
// Then buildResponsePlan() walks the ranked list and takes units from each bank
// until the request is covered, so one request can be split across banks.
// Dormant banks (stock not updated for 30 days, src/lib/stock.js) stay in the
// list but are left out of the plan.

export const URGENCY_LEVELS = ["critical", "urgent", "routine"];

export const WEIGHTS = {
  critical: { eta: 0.45, coverage: 0.15, surplus: 0.2, freshness: 0.2 },
  urgent: { eta: 0.35, coverage: 0.25, surplus: 0.15, freshness: 0.25 },
  routine: { eta: 0.25, coverage: 0.35, surplus: 0.05, freshness: 0.35 },
};

// tau for the ETA score, in minutes.
export const ETA_DECAY_MINUTES = { critical: 30, urgent: 45, routine: 60 };

export const FRESHNESS = { fullHours: 6, zeroHours: 72, unknownScore: 30 };

const MS_PER_HOUR = 3_600_000;

const roundToTenth = (value) => Math.round(value * 10) / 10;
const unitWord = (count) => (count === 1 ? "unit" : "units");

export function etaScore(minutes, urgency = "urgent") {
  const tau = ETA_DECAY_MINUTES[urgency] ?? ETA_DECAY_MINUTES.urgent;
  return roundToTenth(100 * Math.exp(-minutes / tau));
}

export function coverageScore(units, unitsNeeded) {
  if (unitsNeeded <= 0) return 100;
  return roundToTenth(100 * Math.min(1, units / unitsNeeded));
}

export function surplusScore(units, unitsNeeded) {
  const spareUnits = Math.max(0, units - unitsNeeded);
  if (unitsNeeded <= 0) return spareUnits > 0 ? 100 : 0;
  return roundToTenth(100 * (1 - Math.exp(-spareUnits / unitsNeeded)));
}

export function freshnessScore(entryDate, now = new Date()) {
  const updatedAt = parseEntryDate(entryDate);
  if (!updatedAt) return FRESHNESS.unknownScore;
  const hours = (now - updatedAt) / MS_PER_HOUR;
  if (hours <= FRESHNESS.fullHours) return 100;
  if (hours >= FRESHNESS.zeroHours) return 0;
  return roundToTenth(
    (100 * (FRESHNESS.zeroHours - hours)) / (FRESHNESS.zeroHours - FRESHNESS.fullHours),
  );
}

function hoursSinceUpdate(entryDate, now) {
  const updatedAt = parseEntryDate(entryDate);
  return updatedAt ? Math.max(0, (now - updatedAt) / MS_PER_HOUR) : null;
}

function formatAge(hours) {
  if (hours === null) return null;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} days`;
}

// "About 42 min by road at this hour (heavy traffic)".
function describeEta(source, trafficLabel) {
  const condition = trafficLabel ? ` (${trafficLabel})` : "";
  return source.etaSource === "road"
    ? `About ${source.etaMinutes} min by road at this hour${condition}`
    : `About ${source.etaMinutes} min at this hour${condition}, estimated from straight-line distance`;
}

// "6 O-Ve units listed: covers the 3 needed, with 3 to spare".
function describeStock(source, unitsNeeded) {
  const listed = `${source.units} ${source.groupName ?? ""} ${unitWord(source.units)} listed`
    .replace(/\s+/g, " ")
    .trim();
  if (source.units < unitsNeeded) return `${listed}: ${source.units} of the ${unitsNeeded} needed`;
  const spareUnits = source.units - unitsNeeded;
  return spareUnits === 0
    ? `${listed}: exactly the ${unitsNeeded} needed, none to spare`
    : `${listed}: covers the ${unitsNeeded} needed, with ${spareUnits} to spare`;
}

// Three plain-language reasons for a bank's rank: travel, stock, freshness.
function buildReasons(source, freshness, unitsNeeded, now, trafficLabel) {
  const reasons = [describeEta(source, trafficLabel), describeStock(source, unitsNeeded)];
  const age = formatAge(hoursSinceUpdate(source.entryDate, now));
  if (source.isDormant) reasons.push(`Stock not updated for ${age}, so it is left out of the plan`);
  else if (age === null) reasons.push("No stock update time listed, so call to confirm");
  else if (freshness >= 100) reasons.push(`Stock updated ${age} ago`);
  else reasons.push(`Stock last updated ${age} ago, so call to confirm`);
  return reasons;
}

// sources: [{ hospitalCode, name, units, groupName, etaMinutes, etaSource, entryDate, ... }]
// where units is the bank's stock of the exact group asked for.
// Returns the sources sorted by score, each with score, breakdown and reasons.
// weights overrides the urgency's weights, for sensitivity analysis.
export function rankSources(
  sources,
  {
    urgency = "urgent",
    unitsNeeded = 1,
    now = new Date(),
    trafficLabel = null,
    weights = WEIGHTS[urgency] ?? WEIGHTS.urgent,
  } = {},
) {
  return sources
    .filter((source) => source.units > 0)
    .map((source) => {
      const breakdown = {
        eta: etaScore(source.etaMinutes, urgency),
        coverage: coverageScore(source.units, unitsNeeded),
        surplus: surplusScore(source.units, unitsNeeded),
        freshness: freshnessScore(source.entryDate, now),
      };
      const score = roundToTenth(
        Object.entries(weights).reduce(
          (sum, [scoreName, weight]) => sum + weight * breakdown[scoreName],
          0,
        ),
      );
      const reasons = buildReasons(source, breakdown.freshness, unitsNeeded, now, trafficLabel);
      return { ...source, score, breakdown, reasons };
    })
    .sort((a, b) => b.score - a.score || a.etaMinutes - b.etaMinutes);
}

// Greedy allocation down the ranked list, skipping dormant banks.
export function buildResponsePlan(rankedSources, unitsNeeded) {
  let unitsRemaining = unitsNeeded;
  const steps = [];

  for (const source of rankedSources) {
    if (unitsRemaining <= 0) break;
    if (source.isDormant) continue;
    const units = Math.min(source.units, unitsRemaining);
    if (units <= 0) continue;
    steps.push({
      hospitalCode: source.hospitalCode,
      name: source.name,
      phone: source.phone ?? null,
      etaMinutes: source.etaMinutes,
      units,
    });
    unitsRemaining -= units;
  }

  const shortfall = Math.max(0, unitsRemaining);
  return { steps, unitsNeeded, unitsCovered: unitsNeeded - shortfall, shortfall };
}
