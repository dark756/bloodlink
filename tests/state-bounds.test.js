import { describe, expect, it } from "vitest";
import { STATE_MARGIN_KM, createStateChecker } from "@/lib/stateBounds";
import stateBoundaries from "../assets/state_boundaries.json";

// Two square test states, 1° wide, side by side, the second with a hole.
const square = (west, south, size) => [
  [west, south],
  [west + size, south],
  [west + size, south + size],
  [west, south + size],
  [west, south],
];
const TEST_BOUNDARIES = {
  states: {
    1: { bbox: [76, 20, 77, 21], polygons: [[square(76, 20, 1)]] },
    2: { bbox: [77, 20, 78, 21], polygons: [[square(77, 20, 1), square(77.4, 20.4, 0.2)]] },
  },
};
const testChecker = createStateChecker(TEST_BOUNDARIES);
const realChecker = createStateChecker(stateBoundaries);

describe("state outlines, on test squares", () => {
  it("measures 0 inside a state and the distance to its edge outside", () => {
    expect(testChecker.distanceOutsideStateKm({ latitude: 20.5, longitude: 76.5 }, "1")).toBe(0);
    // 0.1° east of state 1's edge at latitude 20.5 is about 10.4 km.
    const outside = testChecker.distanceOutsideStateKm({ latitude: 20.5, longitude: 77.1 }, "1");
    expect(outside).toBeGreaterThan(10);
    expect(outside).toBeLessThan(11);
  });
  it("treats a hole as outside", () => {
    expect(
      testChecker.distanceOutsideStateKm({ latitude: 20.5, longitude: 77.5 }, "2"),
    ).toBeGreaterThan(0);
  });
  it("allows the margin at a border, and flags points beyond it", () => {
    const justOver = { latitude: 20.5, longitude: 77.03, stateCode: "1" }; // about 3 km over
    expect(testChecker.locationProblem(justOver)).toBeNull();
    expect(testChecker.locationProblem({ ...justOver, longitude: 77.2 })).toBe("wrong_state");
    expect(STATE_MARGIN_KM).toBe(5);
  });
  it("names missing and outside-India positions, and trusts states it has no outline for", () => {
    expect(testChecker.locationProblem({ latitude: null, longitude: 77, stateCode: "1" })).toBe(
      "missing",
    );
    expect(testChecker.locationProblem({ latitude: 0, longitude: 0, stateCode: "1" })).toBe(
      "missing",
    );
    expect(testChecker.locationProblem({ latitude: 20, longitude: 64, stateCode: "1" })).toBe(
      "outside_india",
    );
    expect(
      testChecker.locationProblem({ latitude: 20.5, longitude: 79, stateCode: "99" }),
    ).toBeNull();
  });
});

describe("state outlines, on the real file", () => {
  it("covers all 36 eRaktKosh states", () => {
    expect(Object.keys(stateBoundaries.states)).toHaveLength(36);
  });
  // Cases seen live on 2026-10-24.
  it("flags banks eRaktKosh placed in another state", () => {
    // Atulaya Blood Centre, Muktsar, Punjab (93), placed in central Delhi.
    expect(
      realChecker.locationProblem({ latitude: 28.6122, longitude: 77.20859, stateCode: 93 }),
    ).toBe("wrong_state");
    // Government District Head Quarters Hospital, Wallajah, Tamil Nadu (33), placed in Mumbai.
    expect(
      realChecker.locationProblem({ latitude: 19.0149, longitude: 72.8631, stateCode: 33 }),
    ).toBe("wrong_state");
  });
  it("keeps banks inside their own state", () => {
    // Indian Red Cross Society NHQ Blood Centre, New Delhi (97).
    expect(
      realChecker.locationProblem({ latitude: 28.6187, longitude: 77.2109, stateCode: 97 }),
    ).toBeNull();
    // Mumbai (27), Panaji (30) and Port Blair (35).
    expect(
      realChecker.locationProblem({ latitude: 19.076, longitude: 72.8777, stateCode: 27 }),
    ).toBeNull();
    expect(
      realChecker.locationProblem({ latitude: 15.4909, longitude: 73.8278, stateCode: 30 }),
    ).toBeNull();
    expect(
      realChecker.locationProblem({ latitude: 11.6234, longitude: 92.7265, stateCode: 35 }),
    ).toBeNull();
  });
});
