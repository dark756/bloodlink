import { NextResponse } from "next/server";
import {
  UpstreamError,
  fetchAvailability,
  fetchNearest,
  parseCoordinates,
  parseStockFilters,
  summarizeFreshness,
} from "@/lib/eraktkosh";
import { getBloodGroupName, getComponentName, getStateName } from "@/lib/constants";
import { cleanText, exactGroupUnits, isDormant, normalizeAvailabilityRow } from "@/lib/stock";
import { URGENCY_LEVELS, buildResponsePlan, rankSources } from "@/lib/ranking";
import { checkRateLimit, tooManyRequests } from "@/lib/rateLimit";
import { nearestModeRing, rankedModeRing } from "@/lib/rings";
import { fetchRoadLegs } from "@/lib/routing";
import { createStateChecker } from "@/lib/stateBounds";
import { estimateTravel, trafficConditions, trafficZone } from "@/lib/traffic";
import { fetchRainMmPerHour } from "@/lib/weather";
import stateBoundaries from "../../../../assets/state_boundaries.json";

// Location search: density-aware expanding rings (spec at the bottom of
// ../rough_work/blood links.txt).
// 1. One nearest call at the widest radius gives every bank around the user.
//    Banks that eRaktKosh places outside their own state are left out, because
//    their distance is meaningless (src/lib/stateBounds.js).
// 2. More than 10 banks within 15 km means a dense (urban) area, so small rings;
//    otherwise wide (rural) rings.
// 3. Live stock is fetched once per state involved, in parallel. At the same
//    time OSRM times the road trip to every candidate bank, and Open-Meteo
//    reports rain at the pin; src/lib/traffic.js turns both into an ETA for
//    this weekday, hour and area.
//
// Two modes:
// - nearest (no blood group or no component): the smallest ring with an active
//   bank holding matching stock, sorted by distance.
// - ranked (component and blood group given): only banks listing the exact
//   blood group count, the ring grows until the units needed are covered, banks
//   are ranked by src/lib/ranking.js, and a response plan splits the request
//   across banks.
// Ring choice is in src/lib/rings.js; dormant banks are listed but never decide it.

const DENSITY_RADIUS_M = 15_000;
const DENSE_AREA_MIN_BANKS = 10;
const RINGS_M = {
  urban: [5_000, 10_000, 15_000, 25_000],
  rural: [20_000, 50_000, 100_000, 150_000],
};
const SEARCH_RADIUS_M = 150_000;
const MAX_UNITS = 50;
// When the nearest call already showed eRaktKosh is slow or down, the stock
// lookups wait less before serving the saved copy, so a search never waits twice.
const SLOW_UPSTREAM_GIVE_UP_MS = 3_000;
const UPSTREAM_ERROR_MESSAGE =
  "The eRaktKosh blood bank service is not responding. Please try again shortly.";
const stateChecker = createStateChecker(stateBoundaries);

function parseRankingOptions(searchParams) {
  const units = Number(searchParams.get("units") ?? 1);
  if (!Number.isInteger(units) || units < 1 || units > MAX_UNITS) {
    return { error: `Units needed must be a whole number from 1 to ${MAX_UNITS}.` };
  }
  const urgency = searchParams.get("urgency") ?? "urgent";
  if (!URGENCY_LEVELS.includes(urgency)) {
    return { error: "Urgency must be critical, urgent or routine." };
  }
  return { units, urgency };
}

// Stock for every state the candidate banks are in, keyed by String(hospitalCode).
// Each entry is { stockRow, checkedAt }: the row and when bloodLink fetched it.
async function loadInventory(candidateBanks, params, options) {
  const stateCodes = [...new Set(candidateBanks.map((bank) => String(bank.stateCode)))];
  const lookups = await Promise.allSettled(
    stateCodes.map((stateCode) => fetchAvailability({ stateCode, ...params }, options)),
  );
  const inventory = new Map();
  const answers = [];
  const failedStateNames = [];
  lookups.forEach((lookup, index) => {
    if (lookup.status === "fulfilled") {
      answers.push(lookup.value);
      for (const stockRow of lookup.value.data) {
        inventory.set(String(stockRow.hospitalCode), {
          stockRow,
          checkedAt: lookup.value.fetchedAt,
        });
      }
    } else {
      failedStateNames.push(getStateName(stateCodes[index]) ?? `state ${stateCodes[index]}`);
    }
  });
  if (stateCodes.length > 0 && failedStateNames.length === stateCodes.length) {
    throw new UpstreamError("every state lookup failed");
  }
  return { inventory, answers, failedStateNames };
}

// Road legs for every candidate bank, keyed by String(hospitalCode).
async function loadRoadLegs(origin, candidateBanks) {
  const { legs, failed } = await fetchRoadLegs(
    origin,
    candidateBanks.map((bank) => ({ latitude: bank.latitude, longitude: bank.longitude })),
  );
  const legsByCode = new Map(
    candidateBanks.map((bank, index) => [String(bank.hospitalCode), legs[index]]),
  );
  return { legsByCode, failed };
}

// One result card: location from the nearest call, details and stock from blood-availability.
// entryDate is when the bank updated its stock; checkedAt is when bloodLink fetched it.
function toBankResult(nearbyBank, { stockRow, checkedAt }, stock, now) {
  return {
    hospitalCode: String(nearbyBank.hospitalCode),
    name: cleanText(stockRow.hospitalname) || cleanText(nearbyBank.name) || "Blood bank",
    address: cleanText(stockRow.hospitaladd) || cleanText(nearbyBank.address),
    phone: nearbyBank.phone || normalizeAvailabilityRow(stockRow).phone,
    type: stockRow.hospitalType ?? null,
    entryDate: stockRow.entrydate ?? null,
    latitude: nearbyBank.latitude,
    longitude: nearbyBank.longitude,
    distanceM: Math.round(nearbyBank.dist),
    checkedAt: new Date(checkedAt).toISOString(),
    isDormant: isDormant(stockRow.entrydate, now),
    stock,
  };
}

export async function GET(request) {
  const rateLimitResult = checkRateLimit(request, {
    key: "blood-search",
    limit: 20,
    windowMs: 60_000,
  });
  if (!rateLimitResult.ok) return tooManyRequests(rateLimitResult);

  const { searchParams } = new URL(request.url);
  const coords = parseCoordinates(searchParams, "lat", "lng");
  if (coords.error) return NextResponse.json({ error: coords.error }, { status: 400 });
  const { filters, error } = parseStockFilters(searchParams);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const rankingOptions = parseRankingOptions(searchParams);
  if (rankingOptions.error) {
    return NextResponse.json({ error: rankingOptions.error }, { status: 400 });
  }

  const isRankedMode = Boolean(filters.componentId && filters.bloodGroupId);
  const componentName = filters.componentId ? getComponentName(filters.componentId) : null;
  const bloodGroupName = filters.bloodGroupId ? getBloodGroupName(filters.bloodGroupId) : null;

  const now = new Date();
  // Never rejects: a weather failure means no rain factor.
  const rainPromise = fetchRainMmPerHour(coords);

  try {
    const nearestResponse = await fetchNearest({ ...coords, radius: SEARCH_RADIUS_M });
    const reachableBanks = nearestResponse.data.filter((bank) =>
      Number.isFinite(Number(bank.dist)),
    );
    const misplacedBanks = reachableBanks.filter(
      (bank) => stateChecker.locationProblem(bank) !== null,
    );
    const nearbyBanks = reachableBanks
      .filter((bank) => stateChecker.locationProblem(bank) === null)
      .sort((a, b) => a.dist - b.dist);

    const banksWithinDensityRadius = nearbyBanks.filter(
      (bank) => bank.dist <= DENSITY_RADIUS_M,
    ).length;
    const area = banksWithinDensityRadius > DENSE_AREA_MIN_BANKS ? "urban" : "rural";
    const rings = RINGS_M[area];
    const maxRadiusM = rings[rings.length - 1];
    const candidateBanks = nearbyBanks.filter((bank) => bank.dist <= maxRadiusM);
    const countBanksWithin = (radiusM) =>
      radiusM === null
        ? candidateBanks.length
        : candidateBanks.filter((bank) => bank.dist <= radiusM).length;

    // Routing runs alongside the stock lookups and never throws.
    const zone = trafficZone(coords, banksWithinDensityRadius);
    const roadLegsPromise = loadRoadLegs(coords, candidateBanks);
    const loadTravel = async () => {
      const [{ legsByCode, failed }, rainMmPerHour] = await Promise.all([
        roadLegsPromise,
        rainPromise,
      ]);
      const conditions = trafficConditions(zone, { now, rainMmPerHour });
      const withTravel = (bank) => ({
        ...bank,
        ...estimateTravel(
          { straightLineM: bank.distanceM, leg: legsByCode.get(bank.hospitalCode) },
          zone,
          conditions,
        ),
      });
      return { conditions, withTravel, isRoutingDegraded: failed };
    };
    const describeTravel = (conditions, banks, isRoutingDegraded) => ({
      ...conditions,
      roadRoutes: banks.filter((bank) => bank.etaSource === "road").length,
      estimated: banks.filter((bank) => bank.etaSource !== "road").length,
      routingDegraded: isRoutingDegraded,
    });
    const sharedFields = {
      mode: isRankedMode ? "ranked" : "nearest",
      area,
      density: banksWithinDensityRadius,
      rings,
      maxRadiusM,
      // Banks within the widest ring that eRaktKosh places outside their own state.
      misplacedBanks: misplacedBanks.filter((bank) => bank.dist <= maxRadiusM).length,
    };

    const inventoryOptions =
      nearestResponse.upstream === "ok" ? {} : { giveUpMs: SLOW_UPSTREAM_GIVE_UP_MS };
    // stale and partial are kept for older clients; freshness has the detail.
    const freshnessFields = ({ answers, failedStateNames }) => {
      const freshness = summarizeFreshness(answers, failedStateNames, {
        locationAnswer: nearestResponse,
      });
      return {
        freshness,
        stale: freshness.source === "memory" || freshness.source === "saved",
        partial: failedStateNames.length > 0,
      };
    };

    if (!isRankedMode) {
      const [inventoryResult, travel] = await Promise.all([
        loadInventory(candidateBanks, filters, inventoryOptions),
        loadTravel(),
      ]);
      const stockedBanks = [];
      for (const nearbyBank of candidateBanks) {
        const inventoryEntry = inventoryResult.inventory.get(String(nearbyBank.hospitalCode));
        if (!inventoryEntry) continue;
        const { stock } = normalizeAvailabilityRow(inventoryEntry.stockRow, {
          componentName,
          bloodGroupName,
        });
        if (stock.totalUnits > 0) {
          stockedBanks.push(
            travel.withTravel(toBankResult(nearbyBank, inventoryEntry, stock, now)),
          );
        }
      }
      const ringRadiusM = nearestModeRing(rings, stockedBanks);
      const results =
        ringRadiusM === null ? [] : stockedBanks.filter((bank) => bank.distanceM <= ringRadiusM);
      return NextResponse.json({
        ...sharedFields,
        ringRadiusM,
        banksChecked: countBanksWithin(ringRadiusM),
        results,
        travel: describeTravel(travel.conditions, results, travel.isRoutingDegraded),
        ...freshnessFields(inventoryResult),
      });
    }

    // Ranked mode: only the exact blood group counts.
    const [inventoryResult, travel] = await Promise.all([
      loadInventory(candidateBanks, filters, inventoryOptions),
      loadTravel(),
    ]);

    const usableBanks = [];
    for (const nearbyBank of candidateBanks) {
      const inventoryEntry = inventoryResult.inventory.get(String(nearbyBank.hospitalCode));
      if (!inventoryEntry) continue;
      const units = exactGroupUnits(inventoryEntry.stockRow, componentName, bloodGroupName);
      if (units === 0) continue;
      const stock = {
        components: [
          {
            component: componentName,
            units: [{ group: bloodGroupName, units }],
            total: units,
          },
        ],
        totalUnits: units,
      };
      usableBanks.push(
        travel.withTravel({
          ...toBankResult(nearbyBank, inventoryEntry, stock, now),
          units,
          groupName: bloodGroupName,
        }),
      );
    }

    // Grow the ring until the active banks inside it cover the request.
    const ringRadiusM = rankedModeRing(rings, usableBanks, rankingOptions.units);
    const banksInRing =
      ringRadiusM === null ? [] : usableBanks.filter((bank) => bank.distanceM <= ringRadiusM);

    const rankedBanks = rankSources(banksInRing, {
      urgency: rankingOptions.urgency,
      unitsNeeded: rankingOptions.units,
      now,
      trafficLabel: travel.conditions.label,
    });
    const plan = buildResponsePlan(rankedBanks, rankingOptions.units);

    return NextResponse.json({
      ...sharedFields,
      urgency: rankingOptions.urgency,
      unitsNeeded: rankingOptions.units,
      bloodGroup: bloodGroupName,
      ringRadiusM,
      banksChecked: countBanksWithin(ringRadiusM),
      results: rankedBanks.map((bank, index) => ({ ...bank, rank: index + 1 })),
      plan,
      travel: describeTravel(travel.conditions, rankedBanks, travel.isRoutingDegraded),
      ...freshnessFields(inventoryResult),
    });
  } catch (err) {
    console.error("blood-search failed:", err.message);
    const status = err instanceof UpstreamError ? 502 : 500;
    return NextResponse.json({ error: UPSTREAM_ERROR_MESSAGE }, { status });
  }
}
