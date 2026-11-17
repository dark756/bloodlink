import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, jsonError, requireUser } from "@/lib/auth";
import { haversineMeters } from "@/lib/geo";
import {
  sanitizeConfirmDonation,
  sanitizeDefer,
  sanitizeRequest,
  sanitizeTravelConditions,
} from "@/lib/donorRequests";
import { trafficConditions, trafficZone } from "@/lib/traffic";
import { loadBankPositions } from "@/lib/stockStore";
import { fetchRainMmPerHour } from "@/lib/weather";
import { rpcErrorResponse } from "@/app/api/admin/rpcError";

// Requests for the signed-in user's organization (donor network, phases 2 and 3), shadow or live. Every
// query and function call runs as that user, and the id comes only from the session. Before
// the migration is applied the tables and functions don't exist: GET then answers
// { available: false }, and POST says the network isn't open yet.

const DENSITY_RADIUS_M = 15_000;
const LIST_LIMIT = 20;
const REASON_MAX = 200;
// 42P01: Postgres "undefined table". PGRST205: PostgREST's schema cache doesn't know it.
const isMissingTable = (error) => error?.code === "42P01" || error?.code === "PGRST205";
// Also a missing function, before the migration: PGRST202 / 42883.
const isMissingObject = (error) =>
  isMissingTable(error) || ["PGRST202", "42883"].includes(error?.code);

const REQUEST_COLUMNS =
  "id, kind, anchor_hospital_code, blood_group_code, component_id, units_needed, urgency, needed_by, allow_compatible, patient_reference, mode, area, status, waves_sent, next_wave_at, units_donated, created_at, closed_at, close_reason";

const toRequest = (row) => ({
  id: row.id,
  kind: row.kind,
  anchorHospitalCode: row.anchor_hospital_code,
  bloodGroupCode: row.blood_group_code,
  componentCode: row.component_id === null ? null : String(row.component_id),
  unitsNeeded: row.units_needed,
  urgency: row.urgency,
  neededBy: row.needed_by,
  allowCompatible: row.allow_compatible,
  patientReference: row.patient_reference,
  mode: row.mode,
  area: row.area,
  status: row.status,
  wavesSent: row.waves_sent,
  nextWaveAt: row.next_wave_at,
  unitsDonated: row.units_donated,
  createdAt: row.created_at,
  closedAt: row.closed_at,
  closeReason: row.close_reason,
});

// request_wave_summary() rows: counts and bands only, never a donor.
const toWave = (row) => ({
  wave: row.wave,
  ringKm: row.ring_km,
  candidates: row.candidate_count,
  k: row.k,
  pAccept: row.p_accept,
  exactCount: row.exact_count,
  compatibleCount: row.compatible_count,
  distanceBands: row.distance_bands ?? null,
  scoreMin: row.score_min,
  scoreMedian: row.score_median,
  scoreMax: row.score_max,
  filterCounts: row.filter_counts ?? null,
});

// request_donor_contacts() rows: the donors who accepted or arrived. The name is always
// there, the phone only when the donor agreed to share it; each call is logged as a reveal.
const toDonor = (row) => ({
  responseId: row.response_id,
  name: row.donor_name,
  phone: row.phone ?? null,
  phoneShared: row.phone_shared === true,
  status: row.status,
  holdUntil: row.hold_until,
  checkInCode: row.check_in_code ?? null,
});

// Donors are listed for live requests that are still open or covered.

// The signed-in user's approved organization, or null.
async function loadOrganization(supabase, profile) {
  if (!profile?.organization_id) return { organization: null };
  const { data, error } = await supabase
    .from("organizations")
    .select("id, kind, name, eraktkosh_code, status")
    .eq("id", profile.organization_id)
    .eq("status", "approved")
    .maybeSingle();
  if (error) return { error };
  return {
    organization: data
      ? {
          id: data.id,
          kind: data.kind,
          name: data.name,
          eraktkoshCode: data.eraktkosh_code ?? null,
        }
      : null,
  };
}

export async function GET() {
  const supabase = await createClient();
  const { user, response } = await requireUser(supabase);
  if (response) return response;

  const profile = await getCurrentProfile(supabase, user.id);
  const { organization, error: organizationError } = await loadOrganization(supabase, profile);
  if (organizationError) {
    console.error("GET /api/requests failed:", organizationError.code, organizationError.message);
    return jsonError("Could not load your requests. Please try again.", 500);
  }
  if (!organization)
    return NextResponse.json({ available: true, organization: null, requests: [] });

  const { data, error } = await supabase
    .from("blood_requests")
    .select(REQUEST_COLUMNS)
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ available: false });
    console.error("GET /api/requests failed:", error.code, error.message);
    return jsonError("Could not load your requests. Please try again.", 500);
  }

  const summaries = await Promise.all(
    data.map((row) => supabase.rpc("request_wave_summary", { p_request_id: row.id })),
  );
  const failed = summaries.find((summary) => summary.error)?.error;
  if (failed) {
    if (isMissingObject(failed)) return NextResponse.json({ available: false });
    console.error("GET /api/requests summary failed:", failed.code, failed.message);
    return jsonError("Could not load your requests. Please try again.", 500);
  }

  // Donors are not listed here: request_donor_contacts() logs a reveal on every call, so
  // it runs only when staff open a request (the "donors" action).
  return NextResponse.json({
    available: true,
    organization,
    requests: data.map((row, index) => ({
      ...toRequest(row),
      waves: (summaries[index].data ?? []).map(toWave),
    })),
  });
}

// The donors who accepted or arrived, for a request staff have opened.
async function listDonors(supabase, body) {
  const id = body?.id;
  if (!Number.isInteger(id) || id <= 0) return jsonError("Choose a request.", 400);
  const { data, error } = await supabase.rpc("request_donor_contacts", { p_request_id: id });
  if (error) {
    if (isMissingObject(error)) return jsonError("Requests aren't open yet.", 503);
    return rpcErrorResponse(error);
  }
  return NextResponse.json({ donors: (data ?? []).map(toDonor) });
}

export async function POST(request) {
  const supabase = await createClient();
  const { user, response } = await requireUser(supabase);
  if (response) return response;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid request body.", 400);
  }

  if (body?.action === "create") return createRequest(supabase, user, body);
  if (body?.action === "cancel") return cancelRequest(supabase, body);
  if (body?.action === "confirm_donation") return confirmDonation(supabase, body);
  if (body?.action === "defer") return deferDonor(supabase, body);
  if (body?.action === "donors") return listDonors(supabase, body);
  return jsonError("Unknown action.", 400);
}

async function confirmDonation(supabase, body) {
  const { responseId, kind, errors } = sanitizeConfirmDonation(body);
  if (errors.length > 0) return NextResponse.json({ error: errors[0], errors }, { status: 400 });
  const { error } = await supabase.rpc("confirm_donation", {
    p_response_id: responseId,
    p_kind: kind,
  });
  if (error) {
    if (isMissingObject(error)) return jsonError("Requests aren't open yet.", 503);
    return rpcErrorResponse(error);
  }
  return NextResponse.json({ message: "Donation confirmed" });
}

async function deferDonor(supabase, body) {
  const { responseId, reason, errors } = sanitizeDefer(body);
  if (errors.length > 0) return NextResponse.json({ error: errors[0], errors }, { status: 400 });
  const { error } = await supabase.rpc("defer_donor", {
    p_response_id: responseId,
    p_reason: reason,
  });
  if (error) {
    if (isMissingObject(error)) return jsonError("Requests aren't open yet.", 503);
    return rpcErrorResponse(error);
  }
  return NextResponse.json({ message: "Donor deferred" });
}

async function createRequest(supabase, user, body) {
  const profile = await getCurrentProfile(supabase, user.id);
  const { organization, error: organizationError } = await loadOrganization(supabase, profile);
  if (organizationError) {
    console.error("POST /api/requests failed:", organizationError.code, organizationError.message);
    return jsonError("Could not raise the request. Please try again.", 500);
  }
  if (!organization) {
    return jsonError("Only a verified hospital or blood bank can raise a request.", 403);
  }

  const now = new Date();
  const { request: fields, errors } = sanitizeRequest(body, now, {
    canAllowCompatible: organization.kind === "blood_bank",
  });
  if (errors.length > 0) return NextResponse.json({ error: errors[0], errors }, { status: 400 });

  // The anchor's position and the banks around it decide the travel conditions. The
  // database works out the same position again and checks it.
  const positions = await loadBankPositions();
  const anchor = positions.get(fields.anchorHospitalCode);
  if (!anchor) {
    return jsonError("bloodLink has no usable position for that blood bank.", 400);
  }
  let banksWithin15Km = 0;
  for (const position of positions.values()) {
    if (haversineMeters(anchor, position) <= DENSITY_RADIUS_M) banksWithin15Km += 1;
  }
  let rainMmPerHour = null;
  try {
    rainMmPerHour = await fetchRainMmPerHour(anchor);
  } catch {
    rainMmPerHour = null;
  }
  const zone = trafficZone(anchor, banksWithin15Km);
  const conditions = trafficConditions(zone, { now, rainMmPerHour });
  const { conditions: travel, errors: travelErrors } = sanitizeTravelConditions({
    freeFlowKmh: zone.freeFlowKmh,
    congestionPercent: conditions.congestionPercent,
    rainFactor: conditions.rainFactor,
  });
  if (travelErrors.length > 0) {
    console.error("POST /api/requests travel conditions:", travelErrors.join(" "));
    return jsonError("Could not work out the travel conditions. Please try again.", 500);
  }

  const { data, error } = await supabase.rpc("create_request", {
    p_anchor_hospital_code: fields.anchorHospitalCode,
    p_blood_group_code: fields.bloodGroupCode,
    p_component_code: fields.componentCode,
    p_units_needed: fields.unitsNeeded,
    p_urgency: fields.urgency,
    p_needed_by: fields.neededBy,
    p_allow_compatible: fields.allowCompatible,
    p_patient_reference: fields.patientReference,
    p_kind: fields.kind,
    p_zone_free_flow_kmh: travel.freeFlowKmh,
    p_congestion_percent: travel.congestionPercent,
    p_rain_factor: travel.rainFactor,
  });
  if (error) {
    if (isMissingObject(error)) return jsonError("Requests aren't open yet.", 503);
    return rpcErrorResponse(error);
  }
  return NextResponse.json({ message: "Raised", id: data });
}

async function cancelRequest(supabase, body) {
  const id = body.id;
  if (!Number.isInteger(id) || id < 1) return jsonError("Unknown request.", 400);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason === "" || reason.length > REASON_MAX) {
    return jsonError(`Give a reason of up to ${REASON_MAX} characters.`, 400);
  }
  const { error } = await supabase.rpc("cancel_request", { p_request_id: id, p_reason: reason });
  if (error) {
    if (isMissingObject(error)) return jsonError("Requests aren't open yet.", 503);
    return rpcErrorResponse(error);
  }
  return NextResponse.json({ message: "Cancelled" });
}
