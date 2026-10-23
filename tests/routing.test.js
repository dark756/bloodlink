import { describe, expect, it } from "vitest";
import { fetchRoadLegs, parseTable } from "@/lib/routing";
import { parseRainRate } from "@/lib/weather";

const table = (durations, distances) => ({
  code: "Ok",
  durations: [[0, ...durations]],
  distances: [[0, ...distances]],
});

// A stand-in for axios that answers from a list and records each URL.
function fakeHttp(...answers) {
  const calls = [];
  return {
    calls,
    async get(url) {
      calls.push(url);
      const answer = answers.shift();
      if (answer instanceof Error) throw answer;
      return { data: answer };
    },
  };
}

describe("OSRM table parsing", () => {
  it("returns one leg per destination, skipping the source", () => {
    expect(parseTable(table([600, 900], [5000, 8000]), 2)).toEqual([
      { distanceM: 5000, durationS: 600 },
      { distanceM: 8000, durationS: 900 },
    ]);
  });
  it("marks destinations OSRM could not route", () => {
    expect(parseTable(table([null, 900], [null, 8000]), 2)[0]).toBeNull();
  });
  it("rejects errors and the wrong shape", () => {
    expect(() => parseTable({ code: "InvalidQuery" }, 1)).toThrow(/InvalidQuery/);
    expect(() => parseTable(table([600], [5000]), 2)).toThrow(/shape/);
  });
});

describe("fetchRoadLegs", () => {
  // Each test uses its own origin, because the cache is shared.
  it("asks OSRM once, in longitude,latitude order, then serves the cache", async () => {
    const origin = { latitude: 10.1, longitude: 70.1 };
    const banks = [
      { latitude: 10.2, longitude: 70.2 },
      { latitude: 10.3, longitude: 70.3 },
    ];
    const http = fakeHttp(table([600, 900], [5000, 8000]));
    const first = await fetchRoadLegs(origin, banks, { http, minGapMs: 0 });
    expect(first).toEqual({
      legs: [
        { distanceM: 5000, durationS: 600 },
        { distanceM: 8000, durationS: 900 },
      ],
      failed: false,
    });
    expect(http.calls[0]).toContain("70.10000,10.10000;70.20000,10.20000;70.30000,10.30000");

    const second = await fetchRoadLegs(origin, banks, { http, minGapMs: 0 });
    expect(second.legs).toEqual(first.legs);
    expect(http.calls).toHaveLength(1);
  });
  it("returns null legs instead of throwing when OSRM fails", async () => {
    const http = fakeHttp(new Error("timeout of 6000ms exceeded"));
    const result = await fetchRoadLegs(
      { latitude: 11.1, longitude: 71.1 },
      [{ latitude: 11.2, longitude: 71.2 }],
      { http, minGapMs: 0 },
    );
    expect(result).toEqual({ legs: [null], failed: true });
  });
  it("skips banks without coordinates", async () => {
    const http = fakeHttp(table([300], [2000]));
    const result = await fetchRoadLegs(
      { latitude: 12.1, longitude: 72.1 },
      [
        { latitude: null, longitude: null },
        { latitude: 12.2, longitude: 72.2 },
      ],
      { http, minGapMs: 0 },
    );
    expect(result.legs).toEqual([null, { distanceM: 2000, durationS: 300 }]);
    expect(http.calls[0].split(";")).toHaveLength(2);
  });
});

describe("Open-Meteo rain rate", () => {
  it("turns rain in the last interval into mm per hour", () => {
    expect(parseRainRate({ current: { precipitation: 0.6, interval: 900 } })).toBeCloseTo(2.4, 5);
    expect(parseRainRate({ current: { precipitation: 0, interval: 900 } })).toBe(0);
  });
  it("returns null for a missing or odd answer", () => {
    expect(parseRainRate({})).toBeNull();
    expect(parseRainRate({ current: { precipitation: 1, interval: 0 } })).toBeNull();
  });
});
