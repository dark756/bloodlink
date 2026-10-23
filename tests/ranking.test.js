import { describe, expect, it } from "vitest";
import {
  WEIGHTS,
  buildResponsePlan,
  coverageScore,
  etaScore,
  freshnessScore,
  rankSources,
  surplusScore,
} from "@/lib/ranking";
import { exactGroupUnits } from "@/lib/stock";

const MS_PER_HOUR = 3_600_000;
const IST_OFFSET_MS = 5.5 * MS_PER_HOUR;

// Fixed clock: 2026-10-23 12:00 India time.
const NOW = new Date("2026-10-23T06:30:00Z");

// An eRaktKosh-style entry date ("YYYY-MM-DD HH:mm:ss", India time) some hours before NOW.
function hoursBefore(hours) {
  const indiaWallClock = new Date(NOW.getTime() - hours * MS_PER_HOUR + IST_OFFSET_MS);
  return indiaWallClock.toISOString().slice(0, 19).replace("T", " ");
}

// A bank holding `units` of the patient's exact group (O-Ve), etaMinutes away by road.
function makeBank(hospitalCode, etaMinutes, units, updatedHoursAgo = 1) {
  return {
    hospitalCode,
    name: `Bank ${hospitalCode}`,
    etaMinutes,
    etaSource: "road",
    units,
    groupName: "O-Ve",
    entryDate: hoursBefore(updatedHoursAgo),
  };
}

const rank = (banks, urgency, unitsNeeded) =>
  rankSources(banks, { urgency, unitsNeeded, now: NOW });

describe("weights", () => {
  it("add up to 1 for every urgency, with no compatibility term", () => {
    for (const weights of Object.values(WEIGHTS)) {
      expect(Object.values(weights).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 10);
      expect(Object.keys(weights).sort()).toEqual(["coverage", "eta", "freshness", "surplus"]);
    }
  });
  it("reward spare stock most when critical and least when routine", () => {
    expect(WEIGHTS.critical.surplus).toBeGreaterThan(WEIGHTS.urgent.surplus);
    expect(WEIGHTS.urgent.surplus).toBeGreaterThan(WEIGHTS.routine.surplus);
  });
});

describe("component scores", () => {
  it("ETA score falls with time, faster when critical", () => {
    expect(etaScore(10, "critical")).toBe(71.7);
    expect(etaScore(10, "critical")).toBeGreaterThan(etaScore(40, "critical"));
    expect(etaScore(30, "critical")).toBeLessThan(etaScore(30, "routine"));
  });
  it("coverage caps at the units needed", () => {
    expect(coverageScore(1, 2)).toBe(50);
    expect(coverageScore(6, 2)).toBe(100);
  });
  it("surplus rewards units beyond the request, with diminishing returns", () => {
    expect(surplusScore(1, 2)).toBe(0); // short
    expect(surplusScore(2, 2)).toBe(0); // exactly enough, nothing spare
    expect(surplusScore(4, 2)).toBe(63.2); // one request's worth spare
    expect(surplusScore(6, 2)).toBe(86.5); // two requests' worth spare
  });
  it("freshness is full within 6 h, zero after 72 h, 30 when unknown", () => {
    expect(freshnessScore(hoursBefore(2), NOW)).toBe(100);
    expect(freshnessScore(hoursBefore(39), NOW)).toBe(50);
    expect(freshnessScore(hoursBefore(80), NOW)).toBe(0);
    expect(freshnessScore(null, NOW)).toBe(30);
  });
});

describe("exact group only", () => {
  const stockRow = {
    components: {
      "Packed Red Blood Cells": { available_WithQty: "O-Ve : 3, A+Ve : 86, O+Ve : 74" },
    },
  };
  it("counts only the patient's own group", () => {
    expect(exactGroupUnits(stockRow, "Packed Red Blood Cells", "A+Ve")).toBe(86);
    expect(exactGroupUnits(stockRow, "Packed Red Blood Cells", "o-ve")).toBe(3);
  });
  it("does not match a bank that holds only compatible groups", () => {
    // O- and O+ red cells could be given to an A+ patient, but they no longer count.
    expect(exactGroupUnits(stockRow, "Packed Red Blood Cells", "AB+Ve")).toBe(0);
  });
  it("leaves banks without the exact group out of the ranking", () => {
    const ranked = rank([makeBank("None", 5, 0), makeBank("Some", 9, 2)], "urgent", 2);
    expect(ranked.map((bank) => bank.hospitalCode)).toEqual(["Some"]);
  });
});

describe("scenario: critical request for 2 units of O- red cells", () => {
  const nearBank = makeBank("A", 10, 1, 1); // 10 min, 1 unit, fresh
  const farBank = makeBank("B", 40, 6, 30); // 40 min, plenty, 30 h old
  const ranked = rank([farBank, nearBank], "critical", 2);

  it("ranks the nearby bank first", () => {
    // A: 0.45·71.7 + 0.15·50 + 0.20·0 + 0.20·100 = 59.8
    // B: 0.45·26.4 + 0.15·100 + 0.20·86.5 + 0.20·63.6 = 56.9
    expect(ranked.map((bank) => bank.hospitalCode)).toEqual(["A", "B"]);
    expect(ranked[0].score).toBeCloseTo(59.8, 1);
    expect(ranked[1].score).toBeCloseTo(56.9, 1);
  });
  it("explains each rank", () => {
    expect(ranked[0].reasons).toEqual([
      "About 10 min by road at this hour",
      "1 O-Ve unit listed: 1 of the 2 needed",
      "Stock updated 1 h ago",
    ]);
    expect(ranked[1].reasons[1]).toBe("6 O-Ve units listed: covers the 2 needed, with 4 to spare");
    expect(ranked[1].reasons[2]).toMatch(/call to confirm/);
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

describe("scenario: spare stock is rewarded more when urgent", () => {
  // Same travel time and freshness; one bank has exactly the 3 units, the other 9.
  const exactBank = makeBank("Exact", 15, 3);
  const spareBank = makeBank("Spare", 15, 9);
  const margin = (urgency) => {
    const [first, second] = rank([exactBank, spareBank], urgency, 3);
    expect(first.hospitalCode).toBe("Spare");
    return first.score - second.score;
  };

  it("adds the most points when critical and the fewest when routine", () => {
    // surplus(9, 3) = 86.5, times the urgency's surplus weight.
    expect(margin("critical")).toBeCloseTo(17.3, 0);
    expect(margin("urgent")).toBeCloseTo(13, 0);
    expect(margin("routine")).toBeCloseTo(4.3, 0);
  });
  it("is worth a longer trip when critical than when routine", () => {
    // 4 units for a 2-unit request (one request's worth spare) against
    // exactly 2 units 10 min away: the spare bank still wins at 22 min when
    // critical, but not when routine.
    const closeExact = makeBank("Close", 10, 2);
    const fartherSpare = makeBank("Farther", 22, 4);
    expect(rank([closeExact, fartherSpare], "critical", 2)[0].hospitalCode).toBe("Farther");
    expect(rank([closeExact, fartherSpare], "routine", 2)[0].hospitalCode).toBe("Close");
  });
});

describe("scenario: same travel time and stock, different freshness", () => {
  it("prefers the bank that updated recently", () => {
    const ranked = rank([makeBank("Old", 17, 4, 60), makeBank("New", 17, 4, 1)], "urgent", 2);
    expect(ranked[0].hospitalCode).toBe("New");
  });
});

describe("scenario: urgency changes the trade-off", () => {
  const closeBank = makeBank("Close", 7, 1, 50); // near, but stale and short
  const idealBank = makeBank("Ideal", 101, 5, 1); // far, but well stocked and fresh
  it("critical favours the closer bank", () => {
    expect(rank([closeBank, idealBank], "critical", 3)[0].hospitalCode).toBe("Close");
  });
  it("routine favours the better-stocked, fresher bank", () => {
    expect(rank([closeBank, idealBank], "routine", 3)[0].hospitalCode).toBe("Ideal");
  });
});

describe("response plan", () => {
  it("takes units in rank order and stops when covered", () => {
    const ranked = rank(
      [makeBank("A", 5, 2), makeBank("B", 8, 5), makeBank("C", 9, 5)],
      "urgent",
      4,
    );
    const plan = buildResponsePlan(ranked, 4);
    expect(plan.unitsCovered).toBe(4);
    expect(plan.steps.reduce((sum, step) => sum + step.units, 0)).toBe(4);
    expect(plan.steps[0].hospitalCode).toBe(ranked[0].hospitalCode);
  });
  it("reports a shortfall when nearby stock is not enough", () => {
    const ranked = rank([makeBank("A", 10, 1), makeBank("B", 20, 1)], "urgent", 5);
    const plan = buildResponsePlan(ranked, 5);
    expect(plan.unitsCovered).toBe(2);
    expect(plan.shortfall).toBe(3);
  });
});

describe("dormant banks", () => {
  it("stay listed but are left out of the plan", () => {
    const dormantBank = { ...makeBank("Dormant", 5, 9, 24 * 45), isDormant: true };
    const activeBank = makeBank("Active", 25, 3);
    const ranked = rank([dormantBank, activeBank], "critical", 3);
    expect(ranked.map((bank) => bank.hospitalCode)).toContain("Dormant");
    expect(ranked.find((bank) => bank.hospitalCode === "Dormant").reasons[2]).toBe(
      "Stock not updated for 45 days, so it is left out of the plan",
    );
    expect(buildResponsePlan(ranked, 3).steps.map((step) => step.hospitalCode)).toEqual(["Active"]);
  });
});
