import { describe, expect, it } from "vitest";
import {
  buildSuggestions,
  eventForBank,
  forecastForBank,
  isForecastable,
  parseForecastStatus,
  rankingHorizonFor,
  rankingRiskFor,
  suggestionGate,
} from "@/lib/forecastMarks";
import { rankSources } from "@/lib/ranking";

// What search does with forecast_marks()'s answer: the mark and the ranking factor.
const answer = {
  showBadge: true,
  useInRanking: true,
  modelVersion: "stockout-logit-t2-2026-11-04",
  asOf: "2026-11-04T00:30:00+00:00",
  cutOff: 0.33,
  thresholdUnits: 2,
  marks: [
    {
      hospitalCode: "101",
      p: [0.2, 0.4, 0.5],
      reasons: [{ input: "units", contribution: 1.2, text: "only 3 units left" }],
    },
    { hospitalCode: "202", p: [0.05, 0.1, 0.2], reasons: [] },
    { hospitalCode: "303", p: [0.1, 1.4, 0.2], reasons: [] }, // out of range: ignored
  ],
};

describe("the forecast in search", () => {
  it("forecasts red cells in the 8 ABO and Rh groups only", () => {
    expect(isForecastable("12", "16")).toBe(true);
    expect(isForecastable(12, 11)).toBe(true);
    expect(isForecastable("11", "16")).toBe(false); // whole blood
    expect(isForecastable("12", "22")).toBe(false); // Bombay
  });

  it("reads forecast_marks()'s answer, and treats a bad one as everything off", () => {
    const status = parseForecastStatus(answer);
    expect([...status.marks.keys()]).toEqual(["101", "202"]);
    expect(status.marks.get("101")).toEqual({ p: [0.2, 0.4, 0.5], reasons: ["only 3 units left"] });
    expect(status).toMatchObject({
      showBadge: true,
      useInRanking: true,
      cutOff: 0.33,
      thresholdUnits: 2,
    });
    expect(parseForecastStatus(null)).toMatchObject({ showBadge: false, useInRanking: false });
    expect(parseForecastStatus("oops").marks.size).toBe(0);
  });

  it("marks a bank that may run low within 48 h, and one that is low now", () => {
    const status = parseForecastStatus(answer);
    expect(forecastForBank(status, "101", 3)).toMatchObject({
      mayRunLowSoon: true,
      isLowNow: false,
      p48: 0.4,
      reasons: ["only 3 units left"],
    });
    expect(forecastForBank(status, "202", 9)).toMatchObject({ mayRunLowSoon: false, p48: 0.1 });
    // Not scored, since 2 units is already at the threshold.
    expect(forecastForBank(status, "404", 2)).toMatchObject({ isLowNow: true, p48: null });
    expect(forecastForBank(status, "404", 7)).toBeNull();
    expect(forecastForBank({ ...status, showBadge: false }, "101", 3)).toBeNull();
  });

  it("gives the ranking P24 when blood is needed now, and P48 for a routine request", () => {
    const status = parseForecastStatus(answer);
    expect(rankingHorizonFor("critical")).toBe(24);
    expect(rankingRiskFor(status, "101", "urgent")).toBe(0.2);
    expect(rankingRiskFor(status, "101", "routine")).toBe(0.4);
    expect(rankingRiskFor(status, "404", "urgent")).toBeNull();
    expect(rankingRiskFor({ ...status, useInRanking: false }, "101", "urgent")).toBeNull();
  });

  it("scales coverage and surplus by (1 - risk) in the ranking, and says so", () => {
    const bank = {
      hospitalCode: "101",
      units: 6,
      groupName: "O-Ve",
      etaMinutes: 20,
      entryDate: null,
    };
    const [plain] = rankSources([bank], { unitsNeeded: 3 });
    const [risky] = rankSources([{ ...bank, stockoutRisk: 0.5 }], { unitsNeeded: 3 });
    expect(risky.breakdown.coverage).toBe(plain.breakdown.coverage / 2);
    expect(risky.breakdown.surplus).toBeCloseTo(plain.breakdown.surplus / 2, 1);
    expect(risky.breakdown.forecastFactor).toBe(0.5);
    expect(risky.score).toBeLessThan(plain.score);
    expect(risky.reasons.some((reason) => /50% chance/.test(reason))).toBe(true);
    expect(plain.breakdown.forecastFactor).toBeUndefined();
  });
});

describe("admins' events and the suggestions to donors", () => {
  const withEvents = {
    ...answer,
    suggestDonors: true,
    showEvents: true,
    events: [
      {
        id: 7,
        hospitalCode: "202",
        reason: "Camp cancelled this week",
        windowHours: 48,
        endsAt: "2026-11-06T06:30:00+00:00",
      },
    ],
  };
  const bank = (code, distanceKm) => ({
    hospitalCode: code,
    name: `Bank ${code}`,
    address: "",
    phone: null,
    latitude: 22.5,
    longitude: 88.3,
    distanceKm,
  });

  it("reads an event, and shows it only while its flag is on", () => {
    const status = parseForecastStatus(withEvents);
    expect(eventForBank(status, "202")).toMatchObject({ id: 7, windowHours: 48 });
    expect(eventForBank(status, "101")).toBeNull();
    expect(eventForBank({ ...status, showEvents: false }, "202")).toBeNull();
    expect(parseForecastStatus({ ...withEvents, cutOff: null }).cutOff).toBeNull();
  });

  it("suggests only to a complete donor profile that is eligible today", () => {
    expect(suggestionGate(null, null).canSuggest).toBe(false);
    expect(suggestionGate({}, { status: "not-donor" }).message).toMatch(/donor/);
    expect(
      suggestionGate({}, { status: "deferred", nextEligibleDate: "2027-01-10" }).message,
    ).toMatch(/2027-01-10/);
    expect(suggestionGate({}, { status: "review" }).canSuggest).toBe(false);
    expect(suggestionGate({}, { status: "eligible" })).toEqual({ canSuggest: true, message: null });
  });

  it("lists the team's events first, then the forecast's banks above the cut-off, nearest first", () => {
    const status = parseForecastStatus(withEvents);
    const list = buildSuggestions([bank("101", 9), bank("202", 12), bank("303", 2)], status);
    expect(list.map((entry) => [entry.hospitalCode, entry.source])).toEqual([
      ["202", "team"],
      ["101", "forecast"],
    ]);
    expect(list[1]).toMatchObject({ chance48: 0.4, forecastReasons: ["only 3 units left"] });
    // Without the forecast's suggestions flag, only the event is left.
    const teamOnly = buildSuggestions([bank("101", 9), bank("202", 12)], {
      ...status,
      suggestDonors: false,
    });
    expect(teamOnly.map((entry) => entry.hospitalCode)).toEqual(["202"]);
  });
});
