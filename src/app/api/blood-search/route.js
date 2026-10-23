import { NextResponse } from "next/server";
import {
  UpstreamError,
  fetchAvailability,
  fetchNearest,
  parseCoordinates,
  parseStockFilters,
} from "@/lib/eraktkosh";
import { getBloodGroupName, getComponentName } from "@/lib/constants";
import { cleanText, normalizeAvailabilityRow, unitsForComponent } from "@/lib/stock";
import { donorGroupsFor } from "@/lib/compatibility";
import { URGENCY_LEVELS, buildResponsePlan, rankSources } from "@/lib/ranking";
import { checkRateLimit, tooManyRequests } from "@/lib/rateLimit";

// Location search: density-aware expanding rings (spec at the bottom of
// ../rough_work/blood links.txt).
// 1. One nearest call at the widest radius gives every bank around the user.
// 2. More than 10 banks within 15 km means a dense (urban) area, so small rings;
//    otherwise wide (rural) rings.
// 3. Live stock is fetched once per state involved, in parallel.
//
// Two modes:
// - nearest (no blood group or no component): the smallest ring with any
//   matching stock, sorted by distance.
// - ranked (component and blood group given): compatible groups count too, the
//   ring grows until the units needed are covered, banks are ranked by
//   src/lib/ranking.js, and a response plan splits the request across banks.

const DENSITY_RADIUS_M = 15_000;
const DENSE_AREA_MIN_BANKS = 10;
const RINGS_M = {
  urban: [5_000, 10_000, 15_000, 25_000],
  rural: [20_000, 50_000, 100_000, 150_000],
};
const SEARCH_RADIUS_M = 150_000;
const MAX_UNITS = 50;
const UPSTREAM_ERROR_MESSAGE =
  "The eRaktKosh blood bank service is not responding. Please try again shortly.";

function parseRankingOptions(searchParams) {
  const units = Number(searchParams.get("units") ?? 1);
  if (!Number.isInteger(units) || units < 1 || units > MAX_UNITS) {
    return { error: `Units needed must be a whole number from 1 to ${MAX_UNITS}.` };
  }
  const urgency = searchParams.get("urgency") ?? "urgent";
  if (!URGENCY_LEVELS.includes(urgency)) {
    return { error: "Urgency must be critical, urgent or routine." };
  }
  const includeCompatible = searchParams.get("compatible") !== "0";
  return { units, urgency, includeCompatible };
}

// Live stock for every state the candidate banks are in, keyed by String(hospitalCode).
async function loadInventory(candidateBanks, params) {
  const stateCodes = [...new Set(candidateBanks.map((bank) => String(bank.stateCode)))];
  const lookups = await Promise.allSettled(
    stateCodes.map((stateCode) => fetchAvailability({ stateCode, ...params })),
  );
  const inventory = new Map();
  let isStale = false;
  let failedCount = 0;
  for (const lookup of lookups) {
    if (lookup.status === "fulfilled") {
      isStale = isStale || lookup.value.stale;
      for (const row of lookup.value.data) inventory.set(String(row.hospitalCode), row);
    } else {
      failedCount += 1;
    }
  }
  if (stateCodes.length > 0 && failedCount === stateCodes.length) {
    throw new UpstreamError("every state lookup failed");
  }
  return { inventory, isStale, isPartial: failedCount > 0 };
}

// One result card: location from the nearest call, details and stock from blood-availability.
function toBankResult(nearbyBank, stockRow, stock) {
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

  try {
    const nearestResponse = await fetchNearest({ ...coords, radius: SEARCH_RADIUS_M });
    const nearbyBanks = nearestResponse.data
      .filter((bank) => Number.isFinite(Number(bank.dist)))
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
    const sharedFields = {
      mode: isRankedMode ? "ranked" : "nearest",
      area,
      density: banksWithinDensityRadius,
      rings,
      maxRadiusM,
    };

    if (!isRankedMode) {
      const { inventory, isStale, isPartial } = await loadInventory(candidateBanks, filters);
      const stockedBanks = [];
      for (const nearbyBank of candidateBanks) {
        const stockRow = inventory.get(String(nearbyBank.hospitalCode));
        if (!stockRow) continue;
        const { stock } = normalizeAvailabilityRow(stockRow, { componentName, bloodGroupName });
        if (stock.totalUnits > 0) stockedBanks.push(toBankResult(nearbyBank, stockRow, stock));
      }
      const ringRadiusM =
        rings.find((radiusM) => stockedBanks.some((bank) => bank.distanceM <= radiusM)) ?? null;
      return NextResponse.json({
        ...sharedFields,
        ringRadiusM,
        banksChecked: countBanksWithin(ringRadiusM),
        results:
          ringRadiusM === null ? [] : stockedBanks.filter((bank) => bank.distanceM <= ringRadiusM),
        stale: isStale || nearestResponse.stale,
        partial: isPartial,
      });
    }

    // Ranked mode: fetch every group for the component, keep compatible ones.
    const allowedGroups = donorGroupsFor(filters.bloodGroupId, filters.componentId, {
      exactOnly: !rankingOptions.includeCompatible,
    });
    const allowedGroupsByName = new Map(
      allowedGroups.map((group) => [group.name.toLowerCase(), group]),
    );
    const { inventory, isStale, isPartial } = await loadInventory(candidateBanks, {
      componentId: filters.componentId,
    });

    const usableBanks = [];
    for (const nearbyBank of candidateBanks) {
      const stockRow = inventory.get(String(nearbyBank.hospitalCode));
      if (!stockRow) continue;
      const groups = unitsForComponent(stockRow, componentName)
        .map((entry) => ({ ...entry, allowed: allowedGroupsByName.get(entry.group.toLowerCase()) }))
        .filter((entry) => entry.allowed)
        .map((entry) => ({
          code: entry.allowed.code,
          name: entry.allowed.name,
          units: entry.units,
          exact: entry.allowed.exact,
        }));
      if (groups.length === 0) continue;
      const totalUnits = groups.reduce((sum, group) => sum + group.units, 0);
      const stock = {
        components: [
          {
            component: componentName,
            units: groups.map((group) => ({
              group: group.name,
              units: group.units,
              exact: group.exact,
            })),
            total: totalUnits,
          },
        ],
        totalUnits,
      };
      usableBanks.push({ ...toBankResult(nearbyBank, stockRow, stock), groups });
    }

    // Grow the ring until the stock inside it covers the request.
    const unitsWithin = (radiusM) =>
      usableBanks
        .filter((bank) => bank.distanceM <= radiusM)
        .reduce((sum, bank) => sum + bank.stock.totalUnits, 0);
    const ringRadiusM =
      usableBanks.length === 0
        ? null
        : (rings.find((radiusM) => unitsWithin(radiusM) >= rankingOptions.units) ?? maxRadiusM);
    const banksInRing =
      ringRadiusM === null ? [] : usableBanks.filter((bank) => bank.distanceM <= ringRadiusM);

    const rankedBanks = rankSources(banksInRing, {
      urgency: rankingOptions.urgency,
      unitsNeeded: rankingOptions.units,
      area,
    });
    const plan = buildResponsePlan(rankedBanks, rankingOptions.units);

    return NextResponse.json({
      ...sharedFields,
      urgency: rankingOptions.urgency,
      unitsNeeded: rankingOptions.units,
      compatible: rankingOptions.includeCompatible,
      acceptedGroups: allowedGroups.map((group) => group.name),
      ringRadiusM,
      banksChecked: countBanksWithin(ringRadiusM),
      results: rankedBanks.map((bank, index) => ({ ...bank, rank: index + 1 })),
      plan,
      stale: isStale || nearestResponse.stale,
      partial: isPartial,
    });
  } catch (err) {
    console.error("blood-search failed:", err.message);
    const status = err instanceof UpstreamError ? 502 : 500;
    return NextResponse.json({ error: UPSTREAM_ERROR_MESSAGE }, { status });
  }
}
