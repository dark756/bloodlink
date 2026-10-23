import { NextResponse } from "next/server";
import { fetchNearest, parseNearestQuery } from "@/lib/eraktkosh";
import { checkRateLimit, tooManyRequests } from "@/lib/rateLimit";

// Blood banks around a point. Accepts latitude, longitude and radius in meters.
export async function GET(request) {
  const rateLimitResult = checkRateLimit(request, { key: "nearest", limit: 60, windowMs: 60_000 });
  if (!rateLimitResult.ok) return tooManyRequests(rateLimitResult);

  const { searchParams } = new URL(request.url);
  const { params, error } = parseNearestQuery(searchParams);
  if (error) return NextResponse.json({ error }, { status: 400 });

  try {
    const { data, stale } = await fetchNearest(params);
    return NextResponse.json(data, { headers: stale ? { "X-Data-Stale": "1" } : undefined });
  } catch (err) {
    console.error(err.message);
    return NextResponse.json(
      { error: "The eRaktKosh blood bank service is not responding. Please try again shortly." },
      { status: 502 },
    );
  }
}
