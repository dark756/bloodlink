import { describe, expect, it } from "vitest";
import {
  PATIENT_REFERENCE_MAX,
  TRAVEL_BOUNDS,
  sanitizeRequest,
  sanitizeTravelConditions,
} from "@/lib/donorRequests";

const NOW = new Date("2026-11-17T10:00:00Z");
const minutesAhead = (minutes) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const valid = (changes = {}) => ({
  kind: "shortfall",
  anchorHospitalCode: "1234",
  bloodGroupCode: "16",
  componentCode: "12",
  unitsNeeded: 4,
  urgency: "urgent",
  neededBy: minutesAhead(120),
  allowCompatible: false,
  patientReference: "IP-2291",
  ...changes,
});
const run = (changes, options) => sanitizeRequest(valid(changes), NOW, options);

describe("sanitizeRequest", () => {
  it("accepts a valid request and returns exactly the whitelisted fields", () => {
    const { request, errors } = sanitizeRequest({ ...valid(), isAdmin: true, mode: "live" }, NOW);
    expect(errors).toEqual([]);
    expect(Object.keys(request).sort()).toEqual(
      [
        "allowCompatible",
        "anchorHospitalCode",
        "bloodGroupCode",
        "componentCode",
        "kind",
        "neededBy",
        "patientReference",
        "unitsNeeded",
        "urgency",
      ].sort(),
    );
  });

  it("rejects a missing or non-object input", () => {
    expect(sanitizeRequest(null, NOW).errors.length).toBeGreaterThan(0);
    expect(sanitizeRequest([], NOW).errors.length).toBeGreaterThan(0);
  });

  it("accepts only shortfall and apheresis", () => {
    expect(run({ kind: "apheresis" }).errors).toEqual([]);
    for (const kind of ["appeal", "forecast", "camp", "", undefined]) {
      expect(run({ kind }).errors).toContain("Choose shortfall or apheresis.");
    }
  });

  it("accepts the three urgencies only", () => {
    for (const urgency of ["critical", "urgent", "routine"]) {
      expect(run({ urgency }).errors).toEqual([]);
    }
    expect(run({ urgency: "now" }).errors.length).toBe(1);
  });

  it("checks the anchor code, group and component against the lookups", () => {
    expect(run({ anchorHospitalCode: "12a" }).errors.length).toBe(1);
    expect(run({ anchorHospitalCode: "" }).errors.length).toBe(1);
    expect(run({ anchorHospitalCode: 1234 }).errors.length).toBe(1);
    expect(run({ bloodGroupCode: "99" }).errors.length).toBe(1);
    expect(run({ bloodGroupCode: 16 }).errors).toEqual([]);
    expect(run({ componentCode: "99" }).errors.length).toBe(1);
  });

  it("bounds units at 1 to 50, whole numbers only", () => {
    expect(run({ unitsNeeded: 1 }).errors).toEqual([]);
    expect(run({ unitsNeeded: 50 }).errors).toEqual([]);
    for (const unitsNeeded of [0, 51, 2.5, "4", null, NaN]) {
      expect(run({ unitsNeeded }).errors.length).toBe(1);
    }
  });

  it("needs the blood 30 minutes to 14 days ahead", () => {
    expect(run({ neededBy: minutesAhead(30) }).errors).toEqual([]);
    expect(run({ neededBy: minutesAhead(14 * 24 * 60) }).errors).toEqual([]);
    expect(run({ neededBy: minutesAhead(29) }).errors.length).toBe(1);
    expect(run({ neededBy: minutesAhead(14 * 24 * 60 + 1) }).errors.length).toBe(1);
    expect(run({ neededBy: minutesAhead(-60) }).errors.length).toBe(1);
    expect(run({ neededBy: "soon" }).errors.length).toBe(1);
    expect(run({ neededBy: undefined }).errors.length).toBe(1);
  });

  it("normalises neededBy to an ISO string", () => {
    const { request } = run({ neededBy: "2026-11-17T17:30:00+05:30" });
    expect(request.neededBy).toBe("2026-11-17T12:00:00.000Z");
  });

  it("limits the patient reference to 40 characters and makes it optional", () => {
    expect(run({ patientReference: "x".repeat(PATIENT_REFERENCE_MAX) }).errors).toEqual([]);
    expect(run({ patientReference: "x".repeat(PATIENT_REFERENCE_MAX + 1) }).errors.length).toBe(1);
    expect(run({ patientReference: 12 }).errors.length).toBe(1);
    expect(run({ patientReference: "a\nb" }).errors.length).toBe(1);
    expect(run({ patientReference: "  " }).request.patientReference).toBeNull();
    expect(run({ patientReference: undefined }).request.patientReference).toBeNull();
    expect(run({ patientReference: " IP-1 " }).request.patientReference).toBe("IP-1");
  });

  it("takes allowCompatible as a boolean, only from a blood bank", () => {
    expect(run({ allowCompatible: true }).errors).toEqual([]);
    expect(run({ allowCompatible: undefined }).request.allowCompatible).toBe(false);
    expect(run({ allowCompatible: "yes" }).errors.length).toBe(1);
    expect(run({ allowCompatible: 1 }).errors.length).toBe(1);
    expect(run({ allowCompatible: true }, { canAllowCompatible: false }).errors.length).toBe(1);
    expect(run({ allowCompatible: false }, { canAllowCompatible: false }).errors).toEqual([]);
  });
});

describe("sanitizeTravelConditions", () => {
  const conditions = (changes = {}) => ({
    freeFlowKmh: 33.7,
    congestionPercent: 42.5,
    rainFactor: 1.15,
    ...changes,
  });

  it("accepts what trafficConditions produces", () => {
    expect(sanitizeTravelConditions(conditions()).errors).toEqual([]);
    expect(sanitizeTravelConditions(conditions({ rainFactor: 1 })).errors).toEqual([]);
    expect(sanitizeTravelConditions(conditions({ rainFactor: 1.3 })).errors).toEqual([]);
  });

  it("rejects values outside the model's bounds", () => {
    const { freeFlowKmhMax, congestionPercentMax } = TRAVEL_BOUNDS;
    for (const changes of [
      { freeFlowKmh: 0 },
      { freeFlowKmh: freeFlowKmhMax + 1 },
      { congestionPercent: -1 },
      { congestionPercent: congestionPercentMax + 1 },
      { rainFactor: 0.9 },
      { rainFactor: 1.31 },
      { rainFactor: "1" },
      { freeFlowKmh: NaN },
    ]) {
      expect(sanitizeTravelConditions(conditions(changes)).errors.length).toBe(1);
    }
    expect(sanitizeTravelConditions(undefined).errors.length).toBe(3);
  });
});
