import { NextResponse } from "next/server";
import {
  UpstreamError,
  fetchAvailability,
  fetchNearest,
  parseCoordinates,
  parseStockFilters,
} from "@/lib/eraktkosh";
import { getBloodGroupName, getComponentName } from "@/lib/constants";
import { cleanText, normalizeAvailabilityRow } from "@/lib/stock";
import { checkRateLimit, tooManyRequests } from "@/lib/rateLimit";

// Density-aware expanding ring search (spec at the bottom of ../rough_work/blood links.txt).
// 1. One nearest call at the widest radius gives every bank around the user.
// 2. More than 10 banks within 15 km means a dense (urban) area, so small rings;
//    otherwise wide (rural) rings.
// 3. Live stock is fetched once per state involved, in parallel.
// 4. The answer is the smallest ring that has at least one bank with matching
//    stock, sorted by distance.

const DENSITY_RADIUS_M = 15_000;
const DENSE_AREA_MIN_BANKS = 10;
const RINGS_M = {
  urban: [5_000, 10_000, 15_000, 25_000],
  rural: [20_000, 50_000, 100_000, 150_000],
};
const SEARCH_RADIUS_M = 150_000;

export async function GET(request) {
  const limit = checkRateLimit(request, { key: "blood-search", limit: 20, windowMs: 60_000 });
  if (!limit.ok) return tooManyRequests(limit);

  const { searchParams } = new URL(request.url);
  const coords = parseCoordinates(searchParams, "lat", "lng");
  if (coords.error) return NextResponse.json({ error: coords.error }, { status: 400 });
  const { filters, error } = parseStockFilters(searchParams);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const stockFilters = {
    componentName: filters.componentId ? getComponentName(filters.componentId) : null,
    bloodGroupName: filters.bloodGroupId ? getBloodGroupName(filters.bloodGroupId) : null,
  };

  try {
    const nearest = await fetchNearest({ ...coords, radius: SEARCH_RADIUS_M });
    const nearby = nearest.data
      .filter((b) => Number.isFinite(Number(b.dist)))
      .sort((a, b) => a.dist - b.dist);

    const density = nearby.filter((b) => b.dist <= DENSITY_RADIUS_M).length;
    const area = density > DENSE_AREA_MIN_BANKS ? "urban" : "rural";
    const rings = RINGS_M[area];
    const candidates = nearby.filter((b) => b.dist <= rings[rings.length - 1]);

    const stateCodes = [...new Set(candidates.map((b) => String(b.stateCode)))];
    const lookups = await Promise.allSettled(
      stateCodes.map((stateCode) => fetchAvailability({ stateCode, ...filters }))
    );

    const inventory = new Map();
    let stale = nearest.stale;
    let failedStates = 0;
    for (const lookup of lookups) {
      if (lookup.status === "fulfilled") {
        stale = stale || lookup.value.stale;
        for (const row of lookup.value.data) inventory.set(String(row.hospitalCode), row);
      } else {
        failedStates += 1;
      }
    }
    if (stateCodes.length > 0 && failedStates === stateCodes.length) {
      throw new UpstreamError("every state lookup failed");
    }

    const stocked = [];
    for (const bank of candidates) {
      const row = inventory.get(String(bank.hospitalCode));
      if (!row) continue;
      const normalized = normalizeAvailabilityRow(row, stockFilters);
      if (normalized.stock.totalUnits === 0) continue;
      stocked.push({
        ...normalized,
        name: cleanText(row.hospitalname) || cleanText(bank.name) || normalized.name,
        address: cleanText(row.hospitaladd) || cleanText(bank.address),
        phone: bank.phone || normalized.phone,
        latitude: bank.latitude,
        longitude: bank.longitude,
        distanceM: Math.round(bank.dist),
      });
    }

    const ringRadiusM = rings.find((r) => stocked.some((b) => b.distanceM <= r)) ?? null;
    const results = ringRadiusM === null ? [] : stocked.filter((b) => b.distanceM <= ringRadiusM);
    const banksChecked =
      ringRadiusM === null ? candidates.length : candidates.filter((b) => b.dist <= ringRadiusM).length;

    return NextResponse.json({
      area,
      density,
      rings,
      maxRadiusM: rings[rings.length - 1],
      ringRadiusM,
      banksChecked,
      results,
      stale,
      partial: failedStates > 0,
    });
  } catch (err) {
    console.error("blood-search failed:", err.message);
    const status = err instanceof UpstreamError ? 502 : 500;
    return NextResponse.json(
      { error: "The eRaktKosh blood bank service is not responding. Please try again shortly." },
      { status }
    );
  }
}
