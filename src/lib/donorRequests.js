import { BLOOD_GROUPS, COMPONENTS } from "@/lib/constants";
import { RAIN } from "@/lib/trafficModel";

// The shadow request form's whitelist and validators (donor network, phase 2). Pure, so the
// card, the route and the tests share them. Each rule mirrors a CHECK in
// create_request() and blood_requests; change them together.

// Phase 2 raises shortfalls and apheresis requests only; the other kinds come later.
export const REQUEST_KINDS = ["shortfall", "apheresis"];
export const REQUEST_KIND_LABELS = { shortfall: "Shortfall", apheresis: "Apheresis" };
export const URGENCIES = ["critical", "urgent", "routine"];
export const URGENCY_LABELS = { critical: "Critical", urgent: "Urgent", routine: "Routine" };

export const UNITS_MIN = 1;
export const UNITS_MAX = 50;
export const PATIENT_REFERENCE_MAX = 40;
export const NEEDED_BY_MIN_MS = 30 * 60_000;
export const NEEDED_BY_MAX_MS = 14 * 86_400_000;
const HOSPITAL_CODE_PATTERN = /^\d{1,12}$/;
// Control characters, tabs and line breaks have no place in a patient reference.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

// The travel conditions the route works out with trafficModel.js. Free-flow speeds in the
// TomTom profiles run 28.8 to 39.7 km/h (highway speed is higher), and congestion tops
// out near 115%; the bounds leave room above both. Rain's factor is 1, or one of the
// model's two bands.
export const TRAVEL_BOUNDS = {
  freeFlowKmhMin: 5,
  freeFlowKmhMax: 120,
  congestionPercentMin: 0,
  congestionPercentMax: 200,
  rainFactorMin: 1,
  rainFactorMax: RAIN.heavyFactor,
};

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

// Returns { request, errors }. Unknown keys are dropped; every field except
// patientReference is required. `canAllowCompatible` is true only for a blood bank
// organization: a hospital may not accept compatible groups.
export function sanitizeRequest(input, now = new Date(), { canAllowCompatible = true } = {}) {
  const errors = [];
  const raw = isObject(input) ? input : {};
  if (!isObject(input)) errors.push("The request is missing.");

  const kind = raw.kind;
  if (!REQUEST_KINDS.includes(kind)) errors.push("Choose shortfall or apheresis.");

  const anchorHospitalCode =
    typeof raw.anchorHospitalCode === "string" ? raw.anchorHospitalCode.trim() : "";
  if (!HOSPITAL_CODE_PATTERN.test(anchorHospitalCode)) {
    errors.push("Enter the blood bank's eRaktKosh code, in digits.");
  }

  const bloodGroupCode = String(raw.bloodGroupCode ?? "");
  if (!BLOOD_GROUPS.some((group) => group.code === bloodGroupCode)) {
    errors.push("Choose a blood group.");
  }

  const componentCode = String(raw.componentCode ?? "");
  if (!COMPONENTS.some((component) => component.code === componentCode)) {
    errors.push("Choose a component.");
  }

  const unitsNeeded = raw.unitsNeeded;
  if (!Number.isInteger(unitsNeeded) || unitsNeeded < UNITS_MIN || unitsNeeded > UNITS_MAX) {
    errors.push(`Units needed must be a whole number from ${UNITS_MIN} to ${UNITS_MAX}.`);
  }

  if (!URGENCIES.includes(raw.urgency)) errors.push("Choose critical, urgent or routine.");

  let neededBy = null;
  const neededByTime = typeof raw.neededBy === "string" ? Date.parse(raw.neededBy) : NaN;
  if (Number.isNaN(neededByTime)) {
    errors.push("Enter when the blood is needed.");
  } else if (
    neededByTime < now.getTime() + NEEDED_BY_MIN_MS ||
    neededByTime > now.getTime() + NEEDED_BY_MAX_MS
  ) {
    errors.push("The blood must be needed between 30 minutes and 14 days from now.");
  } else {
    neededBy = new Date(neededByTime).toISOString();
  }

  const allowCompatible = raw.allowCompatible ?? false;
  if (typeof allowCompatible !== "boolean") {
    errors.push("Compatible groups must be yes or no.");
  } else if (allowCompatible && !canAllowCompatible) {
    errors.push("Only a blood bank may accept compatible groups.");
  }

  let patientReference = null;
  if (raw.patientReference !== undefined && raw.patientReference !== null) {
    const text = typeof raw.patientReference === "string" ? raw.patientReference.trim() : null;
    if (text === null || text.length > PATIENT_REFERENCE_MAX || CONTROL_CHARACTERS.test(text)) {
      errors.push(`The patient reference must be at most ${PATIENT_REFERENCE_MAX} characters.`);
    } else if (text !== "") {
      patientReference = text;
    }
  }

  return {
    request: {
      kind,
      anchorHospitalCode,
      bloodGroupCode,
      componentCode,
      unitsNeeded,
      urgency: raw.urgency,
      neededBy,
      allowCompatible: allowCompatible === true,
      patientReference,
    },
    errors,
  };
}

// Returns { conditions, errors } for what trafficConditions() and trafficZone() produced:
// { freeFlowKmh, congestionPercent, rainFactor }, all numbers inside TRAVEL_BOUNDS.
export function sanitizeTravelConditions(input) {
  const errors = [];
  const raw = isObject(input) ? input : {};
  const inRange = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  const { freeFlowKmh, congestionPercent, rainFactor } = raw;
  if (!inRange(freeFlowKmh, TRAVEL_BOUNDS.freeFlowKmhMin, TRAVEL_BOUNDS.freeFlowKmhMax)) {
    errors.push("The free-flow speed is out of range.");
  }
  if (
    !inRange(
      congestionPercent,
      TRAVEL_BOUNDS.congestionPercentMin,
      TRAVEL_BOUNDS.congestionPercentMax,
    )
  ) {
    errors.push("The congestion is out of range.");
  }
  if (!inRange(rainFactor, TRAVEL_BOUNDS.rainFactorMin, TRAVEL_BOUNDS.rainFactorMax)) {
    errors.push("The rain factor is out of range.");
  }
  return { conditions: { freeFlowKmh, congestionPercent, rainFactor }, errors };
}
