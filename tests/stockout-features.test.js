import { describe, expect, it } from "vitest";
import {
  DAYS_OF_SUPPLY_CAP,
  INPUT_NAMES,
  buildCases,
  buildInputs,
  findGaps,
  gridTimesBetween,
  isClearedPage,
  isGridTime,
  labelCase,
  latestGridTime,
  ownershipOf,
  seriesFromHistory,
} from "@/lib/stockoutFeatures";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// 12:00 India time on 4 November 2026, a grid time.
const T = Date.parse("2026-11-04T06:30:00Z");
const event = (offsetMs, groups) => ({ at: T + offsetMs, stock: groups ? { PRBC: groups } : {} });

describe("the 6-hourly India-time grid", () => {
  it("puts grid times at midnight, 06:00, noon and 18:00 India time", () => {
    expect(isGridTime(T)).toBe(true);
    expect(isGridTime("2026-11-03T18:30:00Z")).toBe(true); // midnight in India
    expect(isGridTime("2026-11-04T06:00:00Z")).toBe(false);
    expect(latestGridTime("2026-11-04T12:29:59Z")).toBe(T);
    expect(latestGridTime("2026-11-04T12:30:00Z")).toBe(T + 6 * HOUR);
  });

  it("lists every grid time between two times, both ends included", () => {
    expect(gridTimesBetween("2026-11-04T00:30:00Z", "2026-11-04T12:30:00Z")).toEqual([
      T - 6 * HOUR,
      T,
      T + 6 * HOUR,
    ]);
    expect(gridTimesBetween("2026-11-04T00:31:00Z", "2026-11-04T06:29:00Z")).toEqual([]);
  });
});

describe("rebuilding each bank's series", () => {
  it("groups rows by bank, sorts them by update time and keeps one per update", () => {
    const series = seriesFromHistory([
      { hospital_code: "101", entry_at: "2026-11-02T04:00:00Z", stock: '{"PRBC":{"O+Ve":3}}' },
      { hospital_code: "101", entry_at: new Date("2026-11-01T04:00:00Z"), stock: {} },
      { hospitalCode: "202", entryAt: "2026-11-01T05:00:00Z", stock: { PRBC: { "A+Ve": 1 } } },
      { hospital_code: "101", entry_at: "2026-11-02T04:00:00Z", stock: { PRBC: { "O+Ve": 4 } } },
      { hospital_code: "", entry_at: "2026-11-02T04:00:00Z", stock: {} },
    ]);
    expect([...series.keys()]).toEqual(["101", "202"]);
    expect(series.get("101")).toEqual([
      { at: Date.parse("2026-11-01T04:00:00Z"), stock: {} },
      { at: Date.parse("2026-11-02T04:00:00Z"), stock: { PRBC: { "O+Ve": 4 } } },
    ]);
  });

  it("calls a whole component falling from 10 units or more to zero a cleared page", () => {
    expect(isClearedPage({ PRBC: { "O+Ve": 6, "A+Ve": 4 } }, {}, "PRBC")).toBe(true);
    expect(isClearedPage({ PRBC: { "O+Ve": 6, "A+Ve": 4 } }, { FFP: { "O+Ve": 2 } }, "PRBC")).toBe(
      true,
    );
    expect(isClearedPage({ PRBC: { "O+Ve": 9 } }, {}, "PRBC")).toBe(false);
    expect(isClearedPage({ PRBC: { "O+Ve": 12 } }, { PRBC: { "A+Ve": 1 } }, "PRBC")).toBe(false);
  });

  it("reads hospital_type as one of five kinds of owner", () => {
    expect(ownershipOf("Govt.")).toBe("govt");
    expect(ownershipOf("Private")).toBe("private");
    expect(ownershipOf("Charitable/Vol")).toBe("charitable");
    expect(ownershipOf("Red Cross")).toBe("red_cross");
    expect(ownershipOf(null)).toBe("other");
  });
});

describe("the 19 inputs", () => {
  const events = [
    event(-10 * DAY, { "O+Ve": 10, "A+Ve": 5 }),
    event(-6 * DAY, { "O+Ve": 4, "A+Ve": 5 }),
    event(-5 * DAY, { "A+Ve": 5 }), // O+ runs out
    event(-4 * DAY, { "O+Ve": 8, "A+Ve": 5 }), // and is refilled
    event(-2 * DAY, { "O+Ve": 6, "A+Ve": 3 }),
    event(-12 * HOUR, { "O+Ve": 5, "A+Ve": 3 }),
  ];
  const bank = { stateCode: "27", hospitalType: "Govt.", autoRefresh: true };

  it("builds every input from the last 7 days, as rates per day seen", () => {
    const inputs = buildInputs({ events, bank, group: "O+Ve", asOf: T });
    expect(Object.keys(inputs)).toEqual(INPUT_NAMES);
    expect(inputs).toEqual({
      units: 5,
      bankUnits: 8,
      groupsStocked: 2,
      groupShare: 5 / 8,
      zeroDropsPerDay: 1 / 7,
      change24h: -1, // 6 a day ago
      change72h: -3, // 8 three days ago
      decreasesPerDay: 13 / 7, // 6 + 4 + 2 + 1
      increasesPerDay: 8 / 7,
      daysOfSupply: 5 / (13 / 7),
      bankUsePerDay: 15 / 7, // the 13 of O+ and 2 of A+
      updates24h: 1,
      updatesPerDay: 5 / 7, // the first update is more than 7 days back
      hoursSinceUpdate: 12,
      autoRefresh: 1,
      ownership: "govt",
      stateCode: "27",
      bloodGroup: "O+Ve",
      rhNegative: 0,
    });
  });

  it("scores only groups in stock at banks that aren't dormant", () => {
    expect(buildInputs({ events, bank, group: "B+Ve", asOf: T })).toBeNull();
    expect(buildInputs({ events, bank, group: "O+Ve", asOf: T - 11 * DAY })).toBeNull();
    expect(buildInputs({ events, bank, group: "O+Ve", asOf: T + 31 * DAY })).toBeNull();
    expect(buildInputs({ events, bank, group: "O+Ve", asOf: T + 29 * DAY })).not.toBeNull();
  });

  it("divides by at least one day for a bank first seen hours ago", () => {
    const inputs = buildInputs({
      events: [event(-3 * HOUR, { "O-Ve": 4 }), event(-1 * HOUR, { "O-Ve": 2 })],
      group: "O-Ve",
      asOf: T,
    });
    expect(inputs).toMatchObject({
      decreasesPerDay: 2,
      updatesPerDay: 2,
      updates24h: 2,
      change24h: 0, // no update a day before
      daysOfSupply: 1,
      rhNegative: 1,
      autoRefresh: 0,
      ownership: "other",
    });
  });

  it("treats a cleared page as no drop, no use and no refill", () => {
    const inputs = buildInputs({
      events: [
        event(-3 * DAY, { "O+Ve": 6, "A+Ve": 5 }),
        event(-2 * DAY), // the page cleared
        event(-1 * DAY - HOUR, { "O+Ve": 6, "A+Ve": 5 }), // and back
      ],
      group: "O+Ve",
      asOf: T,
    });
    expect(inputs).toMatchObject({
      zeroDropsPerDay: 0,
      decreasesPerDay: 0,
      increasesPerDay: 0,
      bankUsePerDay: 0,
      daysOfSupply: DAYS_OF_SUPPLY_CAP,
      updatesPerDay: 3 / 3,
    });
  });

  it("counts a small bank using its last units as a real drop to zero", () => {
    const inputs = buildInputs({
      events: [
        event(-3 * DAY, { "O+Ve": 3 }),
        event(-2 * DAY),
        event(-1 * DAY - HOUR, { "O+Ve": 2 }),
      ],
      group: "O+Ve",
      asOf: T,
    });
    expect(inputs.zeroDropsPerDay).toBeCloseTo(1 / 3);
    expect(inputs.increasesPerDay).toBeCloseTo(2 / 3);
  });

  it("builds cases for every bank and group in stock", () => {
    const series = new Map([
      ["101", events],
      ["202", [event(-HOUR, { "B-Ve": 1 })]],
    ]);
    const cases = buildCases({ series, banks: new Map([["101", bank]]), asOf: T });
    expect(cases.map(({ hospitalCode, group }) => `${hospitalCode} ${group}`)).toEqual([
      "101 A+Ve",
      "101 O+Ve",
      "202 B-Ve",
    ]);
    expect(cases[0]).toMatchObject({ asOf: T, inputs: { stateCode: "27" } });
    expect(cases[2].inputs.stateCode).toBe("");
  });
});

describe("labels", () => {
  const before = [event(-HOUR, { "O+Ve": 4, "A+Ve": 9 })];
  const label = (later, options = {}) =>
    labelCase({
      events: [...before, ...later],
      group: "O+Ve",
      asOf: T,
      dataEnd: T + 100 * HOUR,
      ...options,
    });

  it("marks a drop to zero within each horizon", () => {
    expect(label([event(30 * HOUR, { "A+Ve": 9 })])).toEqual([false, true, true]);
    expect(label([event(24 * HOUR, { "A+Ve": 9 })])).toEqual([true, true, true]);
  });

  it("still counts a quick refill as a stock-out", () => {
    expect(
      label([event(5 * HOUR, { "A+Ve": 9 }), event(7 * HOUR, { "O+Ve": 6, "A+Ve": 9 })]),
    ).toEqual([true, true, true]);
  });

  it("leaves out a case whose first zero is a cleared page", () => {
    expect(label([event(10 * HOUR), event(20 * HOUR, { "O+Ve": 3 })])).toEqual([null, null, null]);
    expect(label([event(50 * HOUR)])).toEqual([false, false, null]);
  });

  it("drops windows that run past the data or into a gap", () => {
    expect(label([], { dataEnd: T + 50 * HOUR })).toEqual([false, false, null]);
    expect(label([], { gaps: [[T + 30 * HOUR, T + 40 * HOUR]] })).toEqual([false, null, null]);
    // A drop that was seen counts across a gap, since a gap can only hide one.
    expect(
      label([event(60 * HOUR, { "A+Ve": 9 })], { gaps: [[T + 30 * HOUR, T + 40 * HOUR]] }),
    ).toEqual([false, null, true]);
  });

  it("scores no case already at zero or at a dormant bank", () => {
    expect(labelCase({ events: before, group: "B+Ve", asOf: T, dataEnd: T + 100 * HOUR })).toBe(
      null,
    );
    expect(
      labelCase({ events: before, group: "O+Ve", asOf: T + 31 * DAY, dataEnd: T + 40 * DAY }),
    ).toBe(null);
  });

  it("finds gaps longer than 6.5 hours between sweeps", () => {
    const sweeps = [0, 4.5, 9, 18, 22.5].map((hours) => new Date(T + hours * HOUR).toISOString());
    expect(findGaps(sweeps)).toEqual([[T + 9 * HOUR, T + 18 * HOUR]]);
    expect(findGaps(sweeps, 10)).toEqual([]);
  });
});
