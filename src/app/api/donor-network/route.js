import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, requireUser } from "@/lib/auth";
import {
  AREA_KINDS,
  DONOR_NETWORK_NOTICE_VERSION,
  sanitizeDonorAreas,
  sanitizeDonorSettings,
  toClockTime,
} from "@/lib/donorNetwork";
import { rpcErrorResponse } from "@/app/api/admin/rpcError";

// The signed-in user's own donor-network consent, settings and areas. Every query runs as
// that user, so row-level security limits it to their own rows; the id comes only from the
// session. Before the migration is applied the tables don't exist: GET then answers
// { available: false } and the card says the network isn't open yet.

const PURPOSE = "donor_network";
// 42P01: Postgres "undefined table". PGRST205: PostgREST's schema cache doesn't know it.
const isMissingTable = (error) => error?.code === "42P01" || error?.code === "PGRST205";
// Also a missing function, before the migration: PGRST202 / 42883.
const isMissingObject = (error) =>
  isMissingTable(error) || ["PGRST202", "42883"].includes(error?.code);

const SETTINGS_COLUMNS =
  "is_available, snoozed_until, quiet_start, quiet_end, critical_overrides_quiet, critical_overrides_gap, max_requests_per_week, apheresis_willing, channels";

const toSettings = (row) => ({
  isAvailable: row.is_available,
  snoozedUntil: row.snoozed_until,
  quietStart: toClockTime(row.quiet_start),
  quietEnd: toClockTime(row.quiet_end),
  criticalOverridesQuiet: row.critical_overrides_quiet,
  criticalOverridesGap: row.critical_overrides_gap,
  maxRequestsPerWeek: row.max_requests_per_week,
  apheresisWilling: row.apheresis_willing,
  channels: row.channels,
});

const toSettingsRow = (settings) => ({
  is_available: settings.isAvailable,
  snoozed_until: settings.snoozedUntil,
  quiet_start: settings.quietStart,
  quiet_end: settings.quietEnd,
  critical_overrides_quiet: settings.criticalOverridesQuiet,
  critical_overrides_gap: settings.criticalOverridesGap,
  max_requests_per_week: settings.maxRequestsPerWeek,
  apheresis_willing: settings.apheresisWilling,
  channels: settings.channels,
});

export async function GET() {
  const supabase = await createClient();
  const { user, response } = await requireUser(supabase);
  if (response) return response;

  const [consent, settings, areas, status] = await Promise.all([
    supabase
      .from("consents")
      .select("notice_version, given_at")
      .eq("user_id", user.id)
      .eq("purpose", PURPOSE)
      .is("withdrawn_at", null)
      .maybeSingle(),
    supabase.from("donor_settings").select(SETTINGS_COLUMNS).eq("user_id", user.id).maybeSingle(),
    supabase.from("donor_areas").select("kind, latitude, longitude").eq("user_id", user.id),
    supabase
      .from("donor_status")
      .select(
        "is_in_network, eligible_from, eligible_until, needs_staff_check, screening_confirmed_at",
      )
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const failed = [consent, settings, areas, status].find((result) => result.error)?.error;
  if (failed) {
    if (isMissingTable(failed)) return NextResponse.json({ available: false });
    console.error("GET /api/donor-network failed:", failed.code, failed.message);
    return jsonError("Could not load the donor network. Please try again.", 500);
  }

  return NextResponse.json({
    available: true,
    noticeVersion: DONOR_NETWORK_NOTICE_VERSION,
    consent: consent.data
      ? { noticeVersion: consent.data.notice_version, givenAt: consent.data.given_at }
      : null,
    settings: settings.data ? toSettings(settings.data) : null,
    areas: (areas.data ?? [])
      .map((area) => ({
        kind: area.kind,
        latitude: Number(area.latitude),
        longitude: Number(area.longitude),
      }))
      .sort((a, b) => AREA_KINDS.indexOf(a.kind) - AREA_KINDS.indexOf(b.kind)),
    status: status.data
      ? {
          isInNetwork: status.data.is_in_network,
          eligibleFrom: status.data.eligible_from,
          eligibleUntil: status.data.eligible_until,
          needsStaffCheck: status.data.needs_staff_check,
          screeningConfirmedAt: status.data.screening_confirmed_at,
        }
      : null,
  });
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

  if (body?.action === "join") {
    if (body.noticeVersion !== DONOR_NETWORK_NOTICE_VERSION) {
      return jsonError("The notice has changed. Please reload the page and read it again.", 400);
    }
    const { error } = await supabase.rpc("give_consent", {
      p_purpose: PURPOSE,
      p_notice_version: DONOR_NETWORK_NOTICE_VERSION,
    });
    if (error) {
      if (isMissingObject(error)) return jsonError("The donor network isn't open yet.", 503);
      return rpcErrorResponse(error);
    }
    return NextResponse.json({ message: "Joined" });
  }

  if (body?.action === "withdraw") {
    const { error } = await supabase.rpc("withdraw_consent", { p_purpose: PURPOSE });
    if (error) {
      if (isMissingObject(error)) return jsonError("The donor network isn't open yet.", 503);
      return rpcErrorResponse(error);
    }
    return NextResponse.json({ message: "Withdrawn" });
  }

  if (body?.action === "save") {
    const { settings, errors: settingsErrors } = sanitizeDonorSettings(body.settings);
    const { areas, errors: areaErrors } = sanitizeDonorAreas(body.areas);
    const errors = [...settingsErrors, ...areaErrors];
    if (errors.length > 0) return NextResponse.json({ error: errors[0], errors }, { status: 400 });

    // Row-level security refuses these writes without an open consent.
    const settingsResult = await supabase
      .from("donor_settings")
      .upsert({ user_id: user.id, ...toSettingsRow(settings) });
    if (settingsResult.error) return saveError(settingsResult.error);

    if (areas.length > 0) {
      const areasResult = await supabase
        .from("donor_areas")
        .upsert(areas.map((area) => ({ user_id: user.id, ...area })));
      if (areasResult.error) return saveError(areasResult.error);
    }
    // Replace: a kind the person removed is deleted.
    const keptKinds = areas.map((area) => area.kind);
    const removedKinds = AREA_KINDS.filter((kind) => !keptKinds.includes(kind));
    if (removedKinds.length > 0) {
      const removeResult = await supabase
        .from("donor_areas")
        .delete()
        .eq("user_id", user.id)
        .in("kind", removedKinds);
      if (removeResult.error) return saveError(removeResult.error);
    }
    return NextResponse.json({ message: "Saved" });
  }

  return jsonError("Unknown action.", 400);
}

function saveError(error) {
  if (isMissingTable(error)) return jsonError("The donor network isn't open yet.", 503);
  // 42501 here is row-level security: no open consent.
  if (error.code === "42501") {
    return jsonError("Join the donor network before saving your settings.", 403);
  }
  console.error("POST /api/donor-network save failed:", error.code, error.message);
  return jsonError("Could not save your settings. Please try again.", 500);
}
