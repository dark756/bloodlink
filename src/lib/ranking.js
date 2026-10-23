import { parseEntryDate } from "./stock";

// Emergency blood-source ranking.
//
// Each candidate blood bank gets four scores from 0 to 100:
//   compatibility  100 if exact-group stock covers the request, 85 if some of it
//                  is exact, 70 if only compatible substitute groups are available
//   eta            100 * e^(-minutes / tau): falls as travel time grows; tau is
//                  shorter for more urgent requests, so distance matters more
//   stock          100 * min(1, usable units / units needed)
//   freshness      100 when stock was updated within 6 h, falling linearly to 0
//                  at 72 h; 30 when the bank gives no update time
// The total is a weighted sum; weights depend on urgency (they add up to 1).
// Until a routing service is added, ETA is estimated from straight-line distance
// times a detour factor at an assumed average speed.
//
// Then buildResponsePlan() walks the ranked list and takes units from each bank
// (exact group first) until the request is covered, so one request can be split
// across banks.

export const URGENCY_LEVELS = ["critical", "urgent", "routine"];

export const WEIGHTS = {
  critical: { compatibility: 0.1, eta: 0.45, stock: 0.25, freshness: 0.2 },
  urgent: { compatibility: 0.2, eta: 0.35, stock: 0.25, freshness: 0.2 },
  routine: { compatibility: 0.25, eta: 0.25, stock: 0.25, freshness: 0.25 },
};

export const TRAVEL = {
  detourFactor: 1.4, // road distance / straight-line distance
  speedKmh: { urban: 25, rural: 45 },
  decayMinutes: { critical: 30, urgent: 45, routine: 60 },
};

export const FRESHNESS = { fullHours: 6, zeroHours: 72, unknownScore: 30 };

const MS_PER_HOUR = 3_600_000;

const roundToTenth = (value) => Math.round(value * 10) / 10;

export function estimateEtaMinutes(distanceM, area = "urban") {
  const roadKm = (distanceM / 1000) * TRAVEL.detourFactor;
  const speedKmh = TRAVEL.speedKmh[area] ?? TRAVEL.speedKmh.urban;
  return Math.max(1, Math.round((roadKm / speedKmh) * 60));
}

export function etaScore(minutes, urgency = "urgent") {
  const tau = TRAVEL.decayMinutes[urgency] ?? TRAVEL.decayMinutes.urgent;
  return roundToTenth(100 * Math.exp(-minutes / tau));
}

export function stockScore(units, unitsNeeded) {
  if (unitsNeeded <= 0) return 100;
  return roundToTenth(100 * Math.min(1, units / unitsNeeded));
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

export function compatibilityScore(exactUnits, unitsNeeded) {
  if (exactUnits >= unitsNeeded) return 100;
  if (exactUnits > 0) return 85;
  return 70;
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

// Four plain-language reasons for a bank's rank: compatibility, travel, stock, freshness.
function buildReasons(source, metrics, unitsNeeded, now) {
  const reasons = [];
  const exactGroups = source.groups.filter((group) => group.exact);
  const substituteGroups = source.groups.filter((group) => !group.exact);
  const unitWord = (count) => (count === 1 ? "unit" : "units");
  const namesOf = (groups) => groups.map((group) => group.name).join(", ");

  // With no substitutes (exact-only searches, or O- red cells), the stock reason covers any shortfall.
  if (metrics.exactUnits >= unitsNeeded || substituteGroups.length === 0) {
    reasons.push(`Exact ${namesOf(exactGroups)} match`);
  } else if (metrics.exactUnits > 0) {
    reasons.push(
      `${metrics.exactUnits} exact ${unitWord(metrics.exactUnits)}, plus compatible ${namesOf(substituteGroups)}`,
    );
  } else {
    reasons.push(`Compatible groups only: ${namesOf(substituteGroups)}`);
  }

  reasons.push(`About ${metrics.etaMinutes} min away by road (estimated from distance)`);

  reasons.push(
    metrics.totalUnits >= unitsNeeded
      ? `${metrics.totalUnits} ${unitWord(metrics.totalUnits)} available, enough for the ${unitsNeeded} needed`
      : `${metrics.totalUnits} of the ${unitsNeeded} ${unitWord(unitsNeeded)} needed`,
  );

  const age = formatAge(hoursSinceUpdate(source.entryDate, now));
  if (age === null) reasons.push("No stock update time listed, so call to confirm");
  else if (metrics.freshness >= 100) reasons.push(`Stock updated ${age} ago`);
  else reasons.push(`Stock last updated ${age} ago, so call to confirm`);

  return reasons;
}

// sources: [{ hospitalCode, name, distanceM, entryDate, groups: [{ code, name, units, exact }] }]
// Returns the sources sorted by score, each with score, breakdown, reasons and etaMinutes.
export function rankSources(
  sources,
  { urgency = "urgent", unitsNeeded = 1, area = "urban", now = new Date() } = {},
) {
  const weights = WEIGHTS[urgency] ?? WEIGHTS.urgent;
  const sumUnits = (groups) => groups.reduce((sum, group) => sum + group.units, 0);

  return sources
    .map((source) => {
      const totalUnits = sumUnits(source.groups);
      const exactUnits = sumUnits(source.groups.filter((group) => group.exact));
      const etaMinutes = estimateEtaMinutes(source.distanceM, area);
      const breakdown = {
        compatibility: compatibilityScore(exactUnits, unitsNeeded),
        eta: etaScore(etaMinutes, urgency),
        stock: stockScore(totalUnits, unitsNeeded),
        freshness: freshnessScore(source.entryDate, now),
      };
      const score = roundToTenth(
        Object.entries(weights).reduce(
          (sum, [scoreName, weight]) => sum + weight * breakdown[scoreName],
          0,
        ),
      );
      const reasons = buildReasons(
        source,
        { ...breakdown, totalUnits, exactUnits, etaMinutes },
        unitsNeeded,
        now,
      );
      return { ...source, totalUnits, exactUnits, etaMinutes, score, breakdown, reasons };
    })
    .sort((a, b) => b.score - a.score || a.distanceM - b.distanceM);
}

// Greedy allocation down the ranked list, exact group first within each bank.
export function buildResponsePlan(rankedSources, unitsNeeded) {
  let unitsRemaining = unitsNeeded;
  const steps = [];

  for (const source of rankedSources) {
    if (unitsRemaining <= 0) break;
    const allocations = [];
    const groupsExactFirst = [...source.groups].sort((a, b) => Number(b.exact) - Number(a.exact));
    for (const group of groupsExactFirst) {
      if (unitsRemaining <= 0) break;
      const units = Math.min(group.units, unitsRemaining);
      if (units > 0) {
        allocations.push({ name: group.name, units, exact: group.exact });
        unitsRemaining -= units;
      }
    }
    if (allocations.length > 0) {
      steps.push({
        hospitalCode: source.hospitalCode,
        name: source.name,
        phone: source.phone ?? null,
        etaMinutes: source.etaMinutes,
        units: allocations.reduce((sum, allocation) => sum + allocation.units, 0),
        allocations,
      });
    }
  }

  const shortfall = Math.max(0, unitsRemaining);
  return { steps, unitsNeeded, unitsCovered: unitsNeeded - shortfall, shortfall };
}
