import { NextResponse } from "next/server";
import { fetchAvailability, parseAvailabilityQuery } from "@/lib/eraktkosh";
import { checkRateLimit, tooManyRequests } from "@/lib/rateLimit";

// Region search: stock for every blood bank in a state, optionally one district.
// Accepts stateCode, districtId (or districtCode), componentId (or ComponentId), bloodGroupId.
export async function GET(request) {
  const limit = checkRateLimit(request, { key: "search", limit: 60, windowMs: 60_000 });
  if (!limit.ok) return tooManyRequests(limit);

  const { searchParams } = new URL(request.url);
  const { params, error } = parseAvailabilityQuery(searchParams);
  if (error) return NextResponse.json({ error }, { status: 400 });

  try {
    const { data, stale } = await fetchAvailability(params);
    return NextResponse.json(data, { headers: stale ? { "X-Data-Stale": "1" } : undefined });
  } catch (err) {
    console.error(err.message);
    return NextResponse.json(
      { error: "The eRaktKosh blood bank service is not responding. Please try again shortly." },
      { status: 502 }
    );
  }
}
