import { getBloodGroupName } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { URGENCY_LABELS } from "@/lib/donorRequests";

// What a donor's request card shows, and the check on the actions the card posts. Pure, so the
// list card, the popup, the route and the tests share them. The cards come from
// my_request_cards(), which never returns patient details or an exact distance.

export const CARD_ACTIONS = ["respond", "cancel", "seen", "check_in"];
const CODE_PATTERN = /^[A-Za-z0-9]{6}$/;

export const URGENCY_HINTS = {
  critical: "Needed within hours",
  urgent: "Needed today or tomorrow",
  routine: "Needed in the coming days",
};

export function urgencyLabel(urgency) {
  return URGENCY_LABELS[urgency] ?? "Request";
}

// my_request_cards() bands the distance to the centre: '5', '10', '15', '25' or 'beyond'.
export function distanceBandText(band) {
  return ["5", "10", "15", "25"].includes(String(band))
    ? `Within ${band} km`
    : "More than 25 km away";
}

export function bloodGroupLabel(code) {
  return getBloodGroupName(code) ?? String(code ?? "");
}

// "23 Oct 2026, 04:30 pm" in India time, whatever the browser's zone.
export function neededByText(value) {
  return formatDateTime(value);
}

// waiting: not answered yet; accepted: a place is held; null: no card state to act on.
export function cardState(card) {
  if (card?.responseStatus === "accepted") return "accepted";
  if (card?.responseStatus === "notified" || card?.responseStatus === "seen") return "waiting";
  return null;
}

// Google Maps directions to the centre, as the other Directions links do; null without a position.
export function directionsUrl(card) {
  const latitude = Number(card?.centreLatitude);
  const longitude = Number(card?.centreLongitude);
  if (card?.centreLatitude == null || card?.centreLongitude == null) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
}

// The database row as the page uses it. Patient details are not in the row.
export function toCard(row) {
  return {
    requestId: Number(row.request_id),
    responseStatus: row.response_status,
    urgency: row.urgency,
    bloodGroupCode: row.blood_group_code,
    componentId: row.component_id,
    centreName: row.centre_name,
    distanceBand: row.distance_band,
    neededBy: row.needed_by,
    holdUntil: row.hold_until,
    centreAddress: row.centre_address,
    centrePhone: row.centre_phone,
    centreLatitude: row.centre_latitude,
    centreLongitude: row.centre_longitude,
    checkInCode: row.check_in_code,
  };
}

// The body of POST /api/donor-requests: { action, requestId, accept?, code? }.
// Returns { error } or { action, requestId, accept?, code? }.
export function sanitizeCardAction(body) {
  if (!body || typeof body !== "object") return { error: "Invalid request body." };
  if (!CARD_ACTIONS.includes(body.action)) return { error: "Unknown action." };
  const requestId = Number(body.requestId);
  if (!Number.isSafeInteger(requestId) || requestId <= 0) {
    return { error: "Choose a request." };
  }
  if (body.action === "respond") {
    if (typeof body.accept !== "boolean") return { error: "Choose accept or decline." };
    return { action: "respond", requestId, accept: body.accept };
  }
  if (body.action === "check_in") {
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!CODE_PATTERN.test(code)) return { error: "The check-in code has 6 letters or digits." };
    return { action: "check_in", requestId, code: code.toUpperCase() };
  }
  return { action: body.action, requestId };
}
