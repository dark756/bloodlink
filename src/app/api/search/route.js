import { NextResponse } from "next/server";
import { fetchAvailability, parseAvailabilityQuery } from "@/lib/eraktkosh";
import { checkRateLimit, tooManyRequests } from "@/lib/rateLimit";

// Region search: stock for every blood bank in a state, optionally one district.
// Accepts stateCode, districtId (or districtCode), componentId (or ComponentId), bloodGroupId.
// X-Data-Source (live, cache, memory or saved) and X-Data-Fetched-At say how fresh it is.
export async function GET(request) {
  const rateLimitResult = checkRateLimit(request, { key: "search", limit: 60, windowMs: 60_000 });
  if (!rateLimitResult.ok) return tooManyRequests(rateLimitResult);

  const { searchParams } = new URL(request.url);
  const { params, error } = parseAvailabilityQuery(searchParams);
  if (error) return NextResponse.json({ error }, { status: 400 });

  try {
    const { data, stale, source, fetchedAt, upstream } = await fetchAvailability(params);
    const headers = {
      "X-Data-Source": source,
      "X-Data-Fetched-At": new Date(fetchedAt).toISOString(),
      "X-Data-Upstream": upstream,
    };
    if (stale) headers["X-Data-Stale"] = "1";
    return NextResponse.json(data, { headers });
  } catch (err) {
    console.error(err.message);
    return NextResponse.json(
      { error: "The eRaktKosh blood bank service is not responding. Please try again shortly." },
      { status: 502 },
    );
  }
}
