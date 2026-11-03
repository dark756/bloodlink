import { NextResponse } from "next/server";
import { parseCoordinates } from "@/lib/eraktkosh";
import { reverseGeocode } from "@/lib/geocoding";
import { checkRateLimit, tooManyRequests } from "@/lib/rateLimit";

// The place name under the search page's map pin. The server asks Nominatim, so the
// browser never sends the pin anywhere but bloodLink (src/lib/geocoding.js).
export async function GET(request) {
  const rateLimitResult = checkRateLimit(request, {
    key: "reverse-geocode",
    limit: 30,
    windowMs: 60_000,
  });
  if (!rateLimitResult.ok) return tooManyRequests(rateLimitResult);

  const coords = parseCoordinates(new URL(request.url).searchParams, "lat", "lng");
  if (coords.error) return NextResponse.json({ error: coords.error }, { status: 400 });
  return NextResponse.json({ label: await reverseGeocode(coords) });
}
