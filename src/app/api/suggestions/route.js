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
import { fixCodesNearPin, locationFixesEnabled, suggestionBanksNearPin } from "@/lib/bankLocations";
import { rowsToDetails } from "@/lib/profileStore";
import { checkRateLimit, tooManyRequests } from "@/lib/rateLimit";
import { extractPhone } from "@/lib/stock";
import { loadLocationFixes } from "@/lib/stockStore";

// Suggestions to donate, for the signed-in person (docs/PLANS/plan_ml_system.md, Part B,
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

// The rows of fixed banks the pin's box did not return: blood_banks first, then, for a
// bank with no directory row at all, its saved stock row (name, address, contact).
async function loadFixedBankRows(supabase, codes) {
  const { data: directoryRows } = await supabase
    .from("blood_banks")
    .select(`${BANK_FIELDS}, state_code, location_quality`)
    .in("hospital_code", codes);
  const rows = (directoryRows ?? []).map((row) => ({
    ...row,
    locationQuality: row.location_quality,
  }));
  const have = new Set(rows.map((row) => String(row.hospital_code)));
  const missing = codes.filter((code) => !have.has(code));
  if (missing.length) {
    const { data: stockRows } = await supabase
      .from("bank_stock_latest")
      .select("hospital_code, state_code, row")
      .in("hospital_code", missing);
    for (const stock of stockRows ?? []) {
      rows.push({
        hospital_code: stock.hospital_code,
        state_code: stock.state_code,
        name: stock.row?.hospitalname || "Blood bank",
        address: stock.row?.hospitaladd ?? null,
        phone: extractPhone(stock.row?.hospitalcontact),
        latitude: null,
        longitude: null,
        locationQuality: "missing",
      });
    }
  }
  return rows;
}

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

    // Corrected positions (#63), as location search applies them: a bank placed by an
    // accepted fix is offered by that position, including banks whose own point is
    // missing or wrong and so are not in the box above. Never fails the request.
    const fixes = locationFixesEnabled() ? await loadLocationFixes() : [];
    const boxRows = data.map((row) => ({ ...row, locationQuality: row.location_quality }));
    const fixedCodes = fixCodesNearPin(
      fixes,
      new Set(data.map((row) => String(row.hospital_code))),
      coords,
      SUGGESTION_RADIUS_KM,
    );
    const extraRows = fixedCodes.length ? await loadFixedBankRows(supabase, fixedCodes) : [];
    banks = suggestionBanksNearPin(
      [...boxRows, ...extraRows].map((row) => ({
        ...row,
        hospitalCode: String(row.hospital_code),
        stateCode: row.state_code ?? null,
      })),
      fixes,
      coords,
      SUGGESTION_RADIUS_KM,
    ).map((bank) => ({
      ...toBank({ ...bank, hospital_code: bank.hospitalCode }, bank.distanceKm),
      latitude: bank.latitude,
      longitude: bank.longitude,
    }));
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
