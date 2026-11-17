import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  DONOR_NETWORK_NOTICE_VERSION,
  roundCell,
  sanitizeDonorAreas,
  sanitizeDonorSettings,
  toClockTime,
} from "@/lib/donorNetwork";

const NOW = new Date("2026-11-17T10:00:00Z");
const valid = (changes = {}) => ({ ...DEFAULT_SETTINGS, ...changes });
const run = (changes) => sanitizeDonorSettings(valid(changes), NOW);
const point = { latitude: 19, longitude: 73 };

describe("roundCell", () => {
  it("rounds to 0.01 degrees", () => {
    expect(roundCell(19.07612)).toBe(19.08);
    expect(roundCell("72.8777")).toBe(72.88);
  });
});

describe("toClockTime", () => {
  it("cuts seconds", () => {
    expect(toClockTime("22:00:00")).toBe("22:00");
    expect(toClockTime("07:00")).toBe("07:00");
  });
});

describe("sanitizeDonorSettings", () => {
  it("accepts the defaults", () => {
    const { settings, errors } = sanitizeDonorSettings(DEFAULT_SETTINGS, NOW);
    expect(errors).toEqual([]);
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });
  it("drops unknown keys", () => {
    expect(run({ userId: "x" }).settings).not.toHaveProperty("userId");
  });
  it("rejects missing input", () => {
    expect(sanitizeDonorSettings(null, NOW).errors.length).toBeGreaterThan(0);
  });
  it("needs real booleans", () => {
    expect(run({ isAvailable: "true" }).errors).toHaveLength(1);
    expect(run({ apheresisWilling: 1 }).errors).toHaveLength(1);
  });
  it("checks quiet hours as HH:MM", () => {
    expect(run({ quietStart: "23:30" }).errors).toEqual([]);
    for (const bad of ["24:00", "7:00", "07:60", "22:00:00", 2200]) {
      expect(run({ quietEnd: bad }).errors).toHaveLength(1);
    }
  });
  it("limits requests a week to 1 to 7", () => {
    for (const ok of [1, 7]) expect(run({ maxRequestsPerWeek: ok }).errors).toEqual([]);
    for (const bad of [0, 8, 2.5, "3", null]) {
      expect(run({ maxRequestsPerWeek: bad }).errors).toHaveLength(1);
    }
  });
  it("whitelists channels, drops duplicates and refuses an empty list", () => {
    expect(run({ channels: ["push", "in_app", "push"] }).settings.channels).toEqual([
      "in_app",
      "push",
    ]);
    expect(run({ channels: [] }).errors).toHaveLength(1);
    expect(run({ channels: ["fax"] }).errors).toHaveLength(1);
    expect(run({ channels: "push" }).errors).toHaveLength(1);
  });
  it("accepts a snooze up to 30 days and no further", () => {
    const week = new Date(NOW.getTime() + 7 * 86_400_000).toISOString();
    expect(run({ snoozedUntil: week }).settings.snoozedUntil).toBe(week);
    const far = new Date(NOW.getTime() + 60 * 86_400_000).toISOString();
    expect(run({ snoozedUntil: far }).errors).toHaveLength(1);
    expect(run({ snoozedUntil: "soon" }).errors).toHaveLength(1);
    expect(run({ snoozedUntil: null }).errors).toEqual([]);
  });
});

describe("sanitizeDonorAreas", () => {
  it("rounds to a cell", () => {
    const { areas, errors } = sanitizeDonorAreas([
      { kind: "home", latitude: 19.07612, longitude: 72.8777 },
    ]);
    expect(errors).toEqual([]);
    expect(areas).toEqual([{ kind: "home", latitude: 19.08, longitude: 72.88 }]);
  });
  it("allows none, or one home and one work", () => {
    expect(sanitizeDonorAreas([]).areas).toEqual([]);
    const two = sanitizeDonorAreas([
      { kind: "work", latitude: 28.61, longitude: 77.2 },
      { kind: "home", latitude: 19.07, longitude: 72.87 },
    ]);
    expect(two.areas).toHaveLength(2);
  });
  it("refuses duplicates, other kinds and more than two", () => {
    const home = { kind: "home", ...point };
    expect(sanitizeDonorAreas([home, home]).errors).toHaveLength(1);
    expect(sanitizeDonorAreas([{ kind: "gym", ...point }]).errors).toHaveLength(1);
    expect(sanitizeDonorAreas([home, { kind: "work", ...point }, home]).errors).toHaveLength(1);
    expect(sanitizeDonorAreas("home").errors).toHaveLength(1);
  });
  it("refuses places outside India and non-numbers", () => {
    const outside = [{ kind: "home", latitude: 51.5, longitude: -0.12 }];
    expect(sanitizeDonorAreas(outside).errors).toHaveLength(1);
    expect(
      sanitizeDonorAreas([{ kind: "home", latitude: "19", longitude: 73 }]).errors,
    ).toHaveLength(1);
    expect(
      sanitizeDonorAreas([{ kind: "home", latitude: 5.99, longitude: 73 }]).errors,
    ).toHaveLength(1);
  });
});

describe("notice version", () => {
  it("is a date", () => {
    expect(DONOR_NETWORK_NOTICE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
