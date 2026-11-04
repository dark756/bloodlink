import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, requireUser } from "@/lib/auth";
import { evaluateEligibility } from "@/lib/eligibility";
import { parseCoordinates } from "@/lib/eraktkosh";
import { fetchForecastStatus } from "@/lib/forecastStore";
import {
  FORECAST_COMPONENT_ID,
  SUGGESTION_RADIUS_KM,
  buildSuggestions,
  suggestionGate,
} from "@/lib/forecastMarks";
import { haversineMeters } from "@/lib/geo";
import { rowsToDetails } from "@/lib/profileStore";
import { checkRateLimit, tooManyRequests } from "@/lib/rateLimit";

// Suggestions to donate, for the signed-in person (docs/PLANS/ML_system.md, Part B,
// as the closed beta runs it). Shown only to someone with a complete donor profile
// whose eligibility is "eligible" today: blood banks within SUGGESTION_RADIUS_KM of the
// pin they allow (rounded to about 110 m, never stored), or in their profile's
// district, where red cells of their own blood group may run low, by an admin's
// event or by the forecast. Nothing is sent to anyone; the person sees this when they
// ask. Queries run as the person, so they read only their own profile.
//
// GET /api/suggestions[?lat=..&lng=..]

const USABLE_LOCATIONS = ["ok", "shared"];
const KM_PER_DEGREE = 111.32;
const BANK_FIELDS = "hospital_code, name, address, phone, latitude, longitude";

const toBank = (row, distanceKm) => ({
  hospitalCode: String(row.hospital_code),
  name: row.name,
  address: row.address,
  phone: row.phone,
  latitude: row.latitude,
  longitude: row.longitude,
  distanceKm,
});

export async function GET(request) {
  const rateLimitResult = checkRateLimit(request, {
    key: "suggestions",
    limit: 20,
    windowMs: 60_000,
  });
  if (!rateLimitResult.ok) return tooManyRequests(rateLimitResult);

  const supabase = await createClient();
  const { user, response } = await requireUser(supabase);
  if (response) return response;

  const [{ data: profile, error }, { data: screening }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("donor_screening").select("*").eq("user_id", user.id).maybeSingle(),
  ]);
  if (error) {
    console.error("GET /api/suggestions failed:", error.message);
    return jsonError("Could not load your profile. Please try again.", 500);
  }
  const details = profile?.is_profile_complete ? rowsToDetails(profile, screening) : null;
  const eligibility = details ? evaluateEligibility(details) : null;
  const gate = suggestionGate(details, eligibility);
  if (!gate.canSuggest) {
    return NextResponse.json({ canSuggest: false, message: gate.message, suggestions: [] });
  }

  const { searchParams } = new URL(request.url);
  let banks;
  let basis;
  if (searchParams.has("lat") || searchParams.has("lng")) {
    const coords = parseCoordinates(searchParams, "lat", "lng");
    if (coords.error) return jsonError(coords.error, 400);
    const latSpan = SUGGESTION_RADIUS_KM / KM_PER_DEGREE;
    const lngSpan =
      SUGGESTION_RADIUS_KM / (KM_PER_DEGREE * Math.cos((coords.latitude * Math.PI) / 180));
    const { data, error: banksError } = await supabase
      .from("blood_banks")
      .select(BANK_FIELDS)
      .in("location_quality", USABLE_LOCATIONS)
      .gte("latitude", coords.latitude - latSpan)
      .lte("latitude", coords.latitude + latSpan)
      .gte("longitude", coords.longitude - lngSpan)
      .lte("longitude", coords.longitude + lngSpan)
      .limit(1000);
    if (banksError) return jsonError("Could not look up blood banks. Please try again.", 500);
    banks = data
      .map((row) => toBank(row, Math.round(haversineMeters(coords, row) / 100) / 10))
      .filter((bank) => bank.distanceKm <= SUGGESTION_RADIUS_KM);
    basis = "location";
  } else {
    if (!profile.district_code) {
      return NextResponse.json({
        canSuggest: true,
        basis: "none",
        message: "Allow your location, or add your district to your profile.",
        suggestions: [],
      });
    }
    const { data, error: banksError } = await supabase
      .from("blood_banks")
      .select(BANK_FIELDS)
      .eq("state_code", profile.state_code)
      .eq("district_id", profile.district_code)
      .limit(500);
    if (banksError) return jsonError("Could not look up blood banks. Please try again.", 500);
    banks = data.map((row) => toBank(row, null));
    basis = "district";
  }

  const status = await fetchForecastStatus({
    hospitalCodes: banks.map((bank) => bank.hospitalCode),
    componentId: FORECAST_COMPONENT_ID,
    bloodGroupId: profile.blood_group_code,
  });
  return NextResponse.json({
    canSuggest: true,
    basis,
    radiusKm: SUGGESTION_RADIUS_KM,
    bloodGroupCode: profile.blood_group_code,
    banksChecked: banks.length,
    suggestions: buildSuggestions(banks, status),
  });
}
