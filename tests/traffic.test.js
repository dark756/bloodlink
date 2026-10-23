import { describe, expect, it } from "vitest";
import trafficProfiles from "../assets/traffic_profiles.json";
import {
  DETOUR_FACTOR,
  RAIN,
  ZONE_SCALE,
  congestionPercent,
  estimateTravel,
  findMetro,
  formatIndiaTime,
  indiaClock,
  rainFactor,
  trafficConditions,
  trafficZone,
} from "@/lib/traffic";

// India time, written with its offset. 2026-10-23 is a Friday.
const at = (localDateTime) => new Date(`${localDateTime}+05:30`);
const FRIDAY_6PM = at("2026-10-23T18:00:00");
const FRIDAY_3AM = at("2026-10-23T03:00:00");

const MUMBAI = { latitude: 19.076, longitude: 72.8777 };
const NASHIK = { latitude: 19.9975, longitude: 73.7898 };
const mumbaiProfile = trafficProfiles.cities.find((city) => city.key === "mumbai");
const mumbaiZone = trafficZone(MUMBAI, 44);

// Mumbai centre to CSMT, as OSRM's table service answered on 2026-10-23.
const MUMBAI_TO_CSMT = { straightLineM: 11_900, leg: { distanceM: 14_223, durationS: 869.6 } };

describe("India clock", () => {
  it("reads weekday, hour and month in India time", () => {
    expect(indiaClock(FRIDAY_6PM)).toEqual({ day: 5, hour: 18, minute: 0, month: 9 });
    expect(formatIndiaTime(at("2026-10-25T09:05:00"))).toBe("Sun 9:05 am");
    expect(formatIndiaTime(at("2026-10-23T00:30:00"))).toBe("Fri 12:30 am");
  });
});

describe("traffic zones", () => {
  it("uses a measured TomTom profile inside a metro area", () => {
    expect(mumbaiZone).toMatchObject({ kind: "metro", name: "Mumbai", freeFlowKmh: 33.7 });
    expect(findMetro(19.0771, 72.9986)?.name).toBe("Mumbai"); // Vashi, inside the 10 km margin
    expect(findMetro(28.6139, 77.209)?.name).toBe("New Delhi");
  });
  it("falls back to bank density outside the measured metros", () => {
    expect(findMetro(NASHIK.latitude, NASHIK.longitude)).toBeNull();
    expect(trafficZone(NASHIK, 20).kind).toBe("city");
    expect(trafficZone(NASHIK, 5).kind).toBe("town");
    expect(trafficZone(NASHIK, 1).kind).toBe("rural");
  });
  it("drives faster outside cities: highway speed when rural, halfway in towns", () => {
    const { freeFlowKmh, highwayFreeFlowKmh } = trafficProfiles.india;
    expect(trafficZone(NASHIK, 20).freeFlowKmh).toBe(freeFlowKmh);
    expect(trafficZone(NASHIK, 5).freeFlowKmh).toBeCloseTo((freeFlowKmh + highwayFreeFlowKmh) / 2);
    expect(trafficZone(NASHIK, 1).freeFlowKmh).toBe(highwayFreeFlowKmh);
  });
});

describe("congestion by time, day, season and density", () => {
  it("reads the measured weekday-hour value times the month's factor", () => {
    const expected = mumbaiProfile.weekHour[5][18] * mumbaiProfile.seasonal[9];
    expect(congestionPercent(mumbaiZone, FRIDAY_6PM)).toBeCloseTo(expected, 0);
  });
  it("is far higher in the evening rush than at night", () => {
    expect(congestionPercent(mumbaiZone, FRIDAY_6PM)).toBeGreaterThan(100);
    expect(congestionPercent(mumbaiZone, FRIDAY_3AM)).toBeLessThan(5);
  });
  it("is lighter on a Sunday morning than a Wednesday morning", () => {
    expect(congestionPercent(mumbaiZone, at("2026-10-25T09:00:00"))).toBeLessThan(
      congestionPercent(mumbaiZone, at("2026-10-21T09:00:00")) / 2,
    );
  });
  it("is higher in the monsoon than in May", () => {
    expect(congestionPercent(mumbaiZone, at("2026-09-16T18:00:00"))).toBeGreaterThan(
      congestionPercent(mumbaiZone, at("2026-05-13T18:00:00")),
    );
  });
  it("interpolates between hours", () => {
    const halfPast = congestionPercent(mumbaiZone, at("2026-10-23T17:30:00"));
    const before = congestionPercent(mumbaiZone, at("2026-10-23T17:00:00"));
    const after = congestionPercent(mumbaiZone, FRIDAY_6PM);
    expect(halfPast).toBeCloseTo((before + after) / 2, 0);
  });
  it("falls with bank density outside the metros", () => {
    const { india } = trafficProfiles;
    const indiaAverage = india.weekHour[5][18] * india.seasonal[9];
    for (const [banks, kind] of [
      [20, "city"],
      [5, "town"],
      [1, "rural"],
    ]) {
      expect(congestionPercent(trafficZone(NASHIK, banks), FRIDAY_6PM)).toBeCloseTo(
        indiaAverage * ZONE_SCALE[kind],
        0,
      );
    }
    expect(ZONE_SCALE.city).toBeGreaterThan(ZONE_SCALE.town);
    expect(ZONE_SCALE.town).toBeGreaterThan(ZONE_SCALE.rural);
  });
});

describe("rain", () => {
  it("adds time only for moderate and heavy rain", () => {
    expect(rainFactor(null)).toBe(1);
    expect(rainFactor(1)).toBe(1);
    expect(rainFactor(RAIN.moderateMmPerHour)).toBe(RAIN.moderateFactor);
    expect(rainFactor(20)).toBe(RAIN.heavyFactor);
  });
});

describe("travel estimate", () => {
  const fridayNight = trafficConditions(mumbaiZone, { now: FRIDAY_3AM });
  const fridayRush = trafficConditions(mumbaiZone, { now: FRIDAY_6PM });

  it("never drives faster than the measured free-flow speed", () => {
    // OSRM says 14.5 min (59 km/h); 14.2 km at 33.7 km/h is 25.3 min.
    expect(estimateTravel(MUMBAI_TO_CSMT, mumbaiZone, fridayNight)).toEqual({
      etaMinutes: 26,
      roadDistanceM: 14_223,
      etaSource: "road",
    });
  });
  it("more than doubles in the Friday evening rush", () => {
    const rush = estimateTravel(MUMBAI_TO_CSMT, mumbaiZone, fridayRush).etaMinutes;
    expect(rush).toBeGreaterThan(2 * 26);
    expect(fridayRush.label).toBe("rush-hour traffic");
  });
  it("keeps OSRM's time where the road is slower than the free-flow speed", () => {
    const hillRoad = { straightLineM: 6_000, leg: { distanceM: 10_000, durationS: 1_800 } };
    expect(estimateTravel(hillRoad, mumbaiZone, fridayNight).etaMinutes).toBe(30);
  });
  it("slows for heavy rain", () => {
    const rainy = trafficConditions(mumbaiZone, { now: FRIDAY_3AM, rainMmPerHour: 12 });
    expect(rainy.rainFactor).toBe(RAIN.heavyFactor);
    expect(estimateTravel(MUMBAI_TO_CSMT, mumbaiZone, rainy).etaMinutes).toBe(
      Math.round(25.32 * (1 + rainy.congestionPercent / 100) * RAIN.heavyFactor),
    );
  });
  it("estimates from straight-line distance when there is no route", () => {
    const noRoute = { straightLineM: 11_900, leg: null };
    const estimate = estimateTravel(noRoute, mumbaiZone, fridayNight);
    const freeFlowMinutes = ((11.9 * DETOUR_FACTOR) / 33.7) * 60;
    expect(estimate.etaSource).toBe("estimate");
    expect(estimate.roadDistanceM).toBeNull();
    expect(estimate.etaMinutes).toBe(
      Math.round(freeFlowMinutes * (1 + fridayNight.congestionPercent / 100)),
    );
  });
});
