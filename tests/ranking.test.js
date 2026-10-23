import { describe, expect, it } from "vitest";
import {
  WEIGHTS,
  buildResponsePlan,
  compatibilityScore,
  estimateEtaMinutes,
  etaScore,
  freshnessScore,
  rankSources,
  stockScore,
} from "@/lib/ranking";

const MS_PER_HOUR = 3_600_000;
const IST_OFFSET_MS = 5.5 * MS_PER_HOUR;

// Fixed clock: 2026-10-23 12:00 India time.
const NOW = new Date("2026-10-23T06:30:00Z");

// An eRaktKosh-style entry date ("YYYY-MM-DD HH:mm:ss", India time) some hours before NOW.
function hoursBefore(hours) {
  const indiaWallClock = new Date(NOW.getTime() - hours * MS_PER_HOUR + IST_OFFSET_MS);
  return indiaWallClock.toISOString().slice(0, 19).replace("T", " ");
}

function makeBank(hospitalCode, distanceKm, groups, updatedHoursAgo = 1) {
  return {
    hospitalCode,
    name: `Bank ${hospitalCode}`,
    distanceM: distanceKm * 1000,
    entryDate: hoursBefore(updatedHoursAgo),
    groups,
  };
}

const exactGroup = (units) => ({ code: "16", name: "O-Ve", units, exact: true });
const substituteGroup = (name, units) => ({ code: "x", name, units, exact: false });

describe("component scores", () => {
  it("weights add up to 1 for every urgency", () => {
    for (const weights of Object.values(WEIGHTS)) {
      expect(Object.values(weights).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 10);
    }
  });
  it("estimates ETA from distance, slower in cities", () => {
    expect(estimateEtaMinutes(3000, "urban")).toBe(10);
    expect(estimateEtaMinutes(3000, "rural")).toBe(6);
  });
  it("ETA score falls with time, faster when critical", () => {
    expect(etaScore(10, "critical")).toBeGreaterThan(etaScore(40, "critical"));
    expect(etaScore(30, "critical")).toBeLessThan(etaScore(30, "routine"));
  });
  it("stock score caps at the units needed", () => {
    expect(stockScore(1, 2)).toBe(50);
    expect(stockScore(6, 2)).toBe(100);
  });
  it("freshness is full within 6 h, zero after 72 h, 30 when unknown", () => {
    expect(freshnessScore(hoursBefore(2), NOW)).toBe(100);
    expect(freshnessScore(hoursBefore(39), NOW)).toBe(50);
    expect(freshnessScore(hoursBefore(80), NOW)).toBe(0);
    expect(freshnessScore(null, NOW)).toBe(30);
  });
  it("compatibility prefers exact stock that covers the request", () => {
    expect(compatibilityScore(2, 2)).toBe(100);
    expect(compatibilityScore(1, 2)).toBe(85);
    expect(compatibilityScore(0, 2)).toBe(70);
  });
});

describe("scenario: critical request for 2 units of O- red cells", () => {
  const nearBank = makeBank("A", 3, [exactGroup(1)], 1); // close, 1 unit, fresh
  const farBank = makeBank("B", 12, [exactGroup(6)], 30); // farther, plenty, 30 h old
  const ranked = rankSources([farBank, nearBank], {
    urgency: "critical",
    unitsNeeded: 2,
    area: "urban",
    now: NOW,
  });

  it("ranks the nearby bank first", () => {
    expect(ranked.map((bank) => bank.hospitalCode)).toEqual(["A", "B"]);
    expect(ranked[0].score).toBeCloseTo(73.3, 1);
    expect(ranked[1].score).toBeCloseTo(59.6, 1);
  });
  it("explains each rank", () => {
    expect(ranked[0].reasons[0]).toBe("Exact O-Ve match");
    expect(ranked[0].reasons.join(" ")).toMatch(/1 of the 2 units needed/);
    expect(ranked[1].reasons.join(" ")).toMatch(/call to confirm/);
  });
  it("splits the request across both banks", () => {
    const plan = buildResponsePlan(ranked, 2);
    expect(plan.steps.map((step) => [step.hospitalCode, step.units])).toEqual([
      ["A", 1],
      ["B", 1],
    ]);
    expect(plan.shortfall).toBe(0);
  });
});

describe("scenario: same distance and stock, different freshness", () => {
  it("prefers the bank that updated recently", () => {
    const ranked = rankSources(
      [makeBank("Old", 5, [exactGroup(4)], 60), makeBank("New", 5, [exactGroup(4)], 1)],
      { urgency: "urgent", unitsNeeded: 2, now: NOW },
    );
    expect(ranked[0].hospitalCode).toBe("New");
  });
});

describe("scenario: exact group versus compatible substitute", () => {
  it("prefers exact stock at equal distance and freshness", () => {
    const ranked = rankSources(
      [makeBank("Sub", 5, [substituteGroup("O-Ve", 4)]), makeBank("Exact", 5, [exactGroup(4)])],
      { urgency: "routine", unitsNeeded: 2, now: NOW },
    );
    expect(ranked[0].hospitalCode).toBe("Exact");
    expect(ranked[1].reasons[0]).toMatch(/compatible groups only/i);
  });
});

describe("scenario: urgency changes the trade-off", () => {
  const closeBank = makeBank("Close", 2, [exactGroup(1)], 50); // near but stale and short
  // At 15 km the well-stocked bank still wins even when critical; at 25 km
  // (about 84 min by the estimate) the closer bank takes over.
  const idealBank = makeBank("Ideal", 25, [exactGroup(5)], 1); // farther but well stocked and fresh
  it("critical favours the closer bank", () => {
    const ranked = rankSources([closeBank, idealBank], {
      urgency: "critical",
      unitsNeeded: 3,
      now: NOW,
    });
    expect(ranked[0].hospitalCode).toBe("Close");
  });
  it("routine favours the better-stocked, fresher bank", () => {
    const ranked = rankSources([closeBank, idealBank], {
      urgency: "routine",
      unitsNeeded: 3,
      now: NOW,
    });
    expect(ranked[0].hospitalCode).toBe("Ideal");
  });
});

describe("response plan", () => {
  it("uses exact units first inside a bank", () => {
    const ranked = rankSources(
      [makeBank("Mixed", 4, [substituteGroup("O-Ve", 5), exactGroup(1)])],
      { unitsNeeded: 3, now: NOW },
    );
    const plan = buildResponsePlan(ranked, 3);
    expect(plan.steps[0].allocations).toEqual([
      { name: "O-Ve", units: 1, exact: true },
      { name: "O-Ve", units: 2, exact: false },
    ]);
    expect(ranked[0].reasons[0]).toBe("1 exact unit, plus compatible O-Ve");
  });
  it("reports a shortfall when nearby stock is not enough", () => {
    const ranked = rankSources(
      [makeBank("A", 3, [exactGroup(1)]), makeBank("B", 6, [exactGroup(1)])],
      { unitsNeeded: 5, now: NOW },
    );
    const plan = buildResponsePlan(ranked, 5);
    expect(plan.unitsCovered).toBe(2);
    expect(plan.shortfall).toBe(3);
  });
});
