import { describe, expect, it } from "vitest";
import { nearestModeRing, rankedModeRing } from "@/lib/rings";

const URBAN_RINGS = [5_000, 10_000, 15_000, 25_000];
const bank = (distanceKm, units, isDormant = false) => ({
  distanceM: distanceKm * 1000,
  units,
  isDormant,
});

describe("nearest mode", () => {
  it("stops at the first ring with an active bank", () => {
    expect(nearestModeRing(URBAN_RINGS, [bank(3, 2), bank(8, 9)])).toBe(5_000);
  });
  it("doesn't let a dormant bank choose the ring", () => {
    // The only bank within 5 km hasn't updated for 30+ days.
    expect(nearestModeRing(URBAN_RINGS, [bank(3, 2, true), bank(8, 9)])).toBe(10_000);
  });
  it("still shows dormant banks when no active bank has stock", () => {
    expect(nearestModeRing(URBAN_RINGS, [bank(12, 4, true)])).toBe(15_000);
  });
  it("is null with no stocked bank", () => {
    expect(nearestModeRing(URBAN_RINGS, [])).toBeNull();
  });
});

describe("ranked mode", () => {
  it("grows until active banks cover the units, ignoring dormant ones", () => {
    const banks = [bank(3, 2), bank(4, 10, true), bank(9, 1), bank(14, 5)];
    expect(rankedModeRing(URBAN_RINGS, banks, 2)).toBe(5_000);
    expect(rankedModeRing(URBAN_RINGS, banks, 3)).toBe(10_000);
    expect(rankedModeRing(URBAN_RINGS, banks, 8)).toBe(15_000);
  });
  it("falls back to the widest ring, or null with no bank", () => {
    expect(rankedModeRing(URBAN_RINGS, [bank(20, 1)], 5)).toBe(25_000);
    expect(rankedModeRing(URBAN_RINGS, [], 1)).toBeNull();
  });
});
