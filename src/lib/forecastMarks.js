// What search and the donor suggestions do with the stock-out forecast and with
// admins' stock-out events (docs/PLANS/ML_system.md, A6 and Parts B and C): the
// "may run low soon" mark, the ranking factor, the "flagged by bloodLink's team" mark,
// and the suggestions to eligible donors nearby. Pure; src/lib/forecastStore.js
// fetches the answer of forecast_marks(), and the routes apply it.
//
// The model predicts low stock: the group's units falling to thresholdUnits or fewer
// within 24, 48 or 72 hours. A bank already at or below the threshold isn't scored;
// it is low now, which the stock itself shows.

// Red cells, the only component the model covers (component code 12, PRBC).
export const FORECAST_COMPONENT_ID = "12";
export const FORECAST_GROUP_CODES = new Set(["11", "12", "13", "14", "15", "16", "17", "18"]);

// The horizon a request's ranking reads: P24 when blood is needed now, P48 for a
// planned (routine) request.
export const rankingHorizonFor = (urgency) => (urgency === "routine" ? 48 : 24);
const HORIZON_INDEX = { 24: 0, 48: 1, 72: 2 };

// Whether a search asks about something the model forecasts.
export function isForecastable(componentId, bloodGroupId) {
  return (
    String(componentId) === FORECAST_COMPONENT_ID && FORECAST_GROUP_CODES.has(String(bloodGroupId))
  );
}

/**
 * forecast_marks()'s answer -> { showBadge, useInRanking, suggestDonors, showEvents,
 * cutOff, thresholdUnits, asOf, modelVersion, marks: Map code -> { p: [p24, p48, p72],
 * reasons: [text] }, events: Map code -> { id, reason, windowHours, endsAt } }. A
 * missing or malformed answer is "everything off".
 */
export function parseForecastStatus(answer) {
  const off = {
    showBadge: false,
    useInRanking: false,
    suggestDonors: false,
    showEvents: false,
    cutOff: null,
    thresholdUnits: 0,
    asOf: null,
    modelVersion: null,
    marks: new Map(),
    events: new Map(),
  };
  if (!answer || typeof answer !== "object") return off;
  const marks = new Map();
  for (const mark of Array.isArray(answer.marks) ? answer.marks : []) {
    const p = Array.isArray(mark?.p) ? mark.p.map(Number) : [];
    if (!mark?.hospitalCode || p.length !== 3 || !p.every((value) => value >= 0 && value <= 1)) {
      continue;
    }
    const reasons = Array.isArray(mark.reasons)
      ? mark.reasons.map((reason) => reason?.text).filter((text) => typeof text === "string")
      : [];
    marks.set(String(mark.hospitalCode), { p, reasons });
  }
  const events = new Map();
  for (const event of Array.isArray(answer.events) ? answer.events : []) {
    if (!event?.hospitalCode || typeof event.reason !== "string") continue;
    events.set(String(event.hospitalCode), {
      id: event.id,
      reason: event.reason,
      windowHours: Number(event.windowHours),
      endsAt: typeof event.endsAt === "string" ? event.endsAt : null,
    });
  }
  const cutOff = answer.cutOff === null ? NaN : Number(answer.cutOff);
  return {
    showBadge: answer.showBadge === true,
    useInRanking: answer.useInRanking === true,
    suggestDonors: answer.suggestDonors === true,
    showEvents: answer.showEvents === true,
    cutOff: Number.isFinite(cutOff) ? cutOff : null,
    thresholdUnits: Number.isInteger(answer.thresholdUnits) ? answer.thresholdUnits : 0,
    asOf: typeof answer.asOf === "string" ? answer.asOf : null,
    modelVersion: typeof answer.modelVersion === "string" ? answer.modelVersion : null,
    marks,
    events,
  };
}

// An admin's active stock-out event at a bank, as search shows it, or null.
export function eventForBank(status, hospitalCode) {
  if (!status.showEvents) return null;
  return status.events.get(String(hospitalCode)) ?? null;
}

// ── suggestions to eligible donors nearby (Part B, for the closed beta) ──────

// How far from the person a bank may be (*assumption*, set in the beta), and how many
// suggestions are shown at most.
export const SUGGESTION_RADIUS_KM = 15;
export const MAX_SUGGESTIONS = 10;

/**
 * Whether a person may be shown suggestions: a complete profile, as a donor, whose
 * eligibility (src/lib/eligibility.js) is "eligible" today. Returns { canSuggest,
 * message } with the reason when not.
 */
export function suggestionGate(details, eligibility) {
  if (!details) {
    return {
      canSuggest: false,
      message: "Complete your profile to see where your blood is needed.",
    };
  }
  if (!eligibility || eligibility.status === "not-donor") {
    return {
      canSuggest: false,
      message: "Mark yourself as a donor in your profile to see where your blood is needed.",
    };
  }
  if (eligibility.status !== "eligible") {
    const when = eligibility.nextEligibleDate
      ? ` You may be eligible again from ${eligibility.nextEligibleDate}.`
      : "";
    return {
      canSuggest: false,
      message: `Your answers say you can't donate right now, so no suggestions are shown.${when}`,
    };
  }
  return { canSuggest: true, message: null };
}

/**
 * The suggestions for one person: banks within reach whose group the person can give
 * may run low, by an admin's event or by the forecast (P48 above the cut-off). banks:
 * [{ hospitalCode, name, address, phone, latitude, longitude, distanceKm }] (distanceKm
 * is null when found by district). An event comes before the forecast at the same
 * bank; nearer banks come first.
 */
export function buildSuggestions(banks, status, { limit = MAX_SUGGESTIONS } = {}) {
  const suggestions = [];
  for (const bank of banks) {
    const event = eventForBank(status, bank.hospitalCode);
    const mark = status.suggestDonors ? status.marks.get(String(bank.hospitalCode)) : null;
    const isForecast = Boolean(mark) && status.cutOff !== null && mark.p[1] > status.cutOff;
    if (!event && !isForecast) continue;
    suggestions.push({
      ...bank,
      source: event ? "team" : "forecast",
      reason: event?.reason ?? null,
      endsAt: event?.endsAt ?? null,
      chance48: isForecast ? mark.p[1] : null,
      forecastReasons: isForecast ? mark.reasons : [],
      thresholdUnits: status.thresholdUnits,
    });
  }
  return suggestions
    .sort(
      (a, b) =>
        (a.source === "team" ? 0 : 1) - (b.source === "team" ? 0 : 1) ||
        (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity),
    )
    .slice(0, limit);
}

/**
 * The forecast as one search result shows it, or null when the badge is off:
 * { p24, p48, p72, mayRunLowSoon, isLowNow, thresholdUnits, reasons, asOf }.
 * mayRunLowSoon is P48 above the cut-off; isLowNow is stock already at or below the
 * threshold. A bank with neither gets only its probabilities, when it was scored.
 */
export function forecastForBank(status, hospitalCode, units) {
  if (!status.showBadge) return null;
  const mark = status.marks.get(String(hospitalCode));
  const isLowNow = Number.isFinite(units) && units > 0 && units <= status.thresholdUnits;
  if (!mark && !isLowNow) return null;
  return {
    p24: mark?.p[0] ?? null,
    p48: mark?.p[1] ?? null,
    p72: mark?.p[2] ?? null,
    mayRunLowSoon: Boolean(mark) && status.cutOff !== null && mark.p[1] > status.cutOff,
    isLowNow,
    thresholdUnits: status.thresholdUnits,
    reasons: mark?.reasons ?? [],
    asOf: status.asOf,
  };
}

// The risk the ranking factor uses for a bank, or null when it doesn't apply: the
// flag is off, or the bank wasn't scored.
export function rankingRiskFor(status, hospitalCode, urgency) {
  if (!status.useInRanking) return null;
  const mark = status.marks.get(String(hospitalCode));
  return mark ? mark.p[HORIZON_INDEX[rankingHorizonFor(urgency)]] : null;
}
