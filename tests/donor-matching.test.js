import { describe, expect, it } from "vitest";
import {
  GROUP_FIT,
  WAVE_SETTINGS,
  donorScore,
  groupsForWave,
  inQuietHours,
  isSnoozed,
  nextRequestStatus,
  passesHardFilters,
  pDonate,
  planWave,
  respondRate,
  restedFactor,
  ringForWave,
  seededRandom,
  showRate,
  travelMinutes,
  waveSize,
  waveTarget,
} from "@/lib/donorMatching";
import { DETOUR_FACTOR } from "@/lib/trafficModel";

// 2026-11-18 11:30 India time, outside quiet hours.
const NOW = new Date("2026-11-18T06:00:00Z");
const DAY_MS = 86_400_000;
const O_NEG = "16";
const O_POS = "15";
const PRBC = "12";
const CONDITIONS = { freeFlowKmh: 30, congestionPercent: 20, rainFactor: 1 };

const makeRequest = (overrides = {}) => ({
  urgency: "critical",
  group: O_NEG,
  component: PRBC,
  allowCompatible: false,
  isApheresis: false,
  neededBy: new Date(NOW.getTime() + 2 * DAY_MS),
  raisedBy: "organizer",
  area: "urban",
  unitsNeeded: 3,
  unitsDonated: 0,
  wavesSent: 0,
  acceptedOnHold: 0,
  conditions: CONDITIONS,
  ...overrides,
});

const makeDonor = (id, distanceKm = 3, overrides = {}) => ({
  id: String(id),
  status: {
    isInNetwork: true,
    eligibleFrom: "2026-01-01",
    eligibleUntil: "2060-01-01",
    needsStaffCheck: false,
    screeningConfirmedAt: "2026-11-01T00:00:00Z",
    bloodGroupCode: O_NEG,
    asksTotal: 0,
    acceptsTotal: 0,
    showsTotal: 0,
    ...overrides.status,
  },
  settings: {
    isAvailable: true,
    snoozedUntil: null,
    quietStart: "22:00",
    quietEnd: "07:00",
    criticalOverridesQuiet: false,
    criticalOverridesGap: false,
    maxRequestsPerWeek: 2,
    apheresisWilling: false,
    ...overrides.settings,
  },
  areas: [{ kind: "home", distanceKm }],
  asksLast7Days: 0,
  lastAskedAt: null,
  alreadyAsked: false,
  ...overrides.top,
});

const crowd = (count, distanceKm, prefix = "d") =>
  Array.from({ length: count }, (_, index) =>
    makeDonor(`${prefix}${String(index).padStart(3, "0")}`, distanceKm),
  );

describe("rates and score", () => {
  it("smooths with the priors", () => {
    expect(respondRate({ accepts: 0, asks: 0 })).toBeCloseTo(0.2);
    expect(showRate({ shows: 0, accepts: 0 })).toBeCloseTo(0.8);
    expect(pDonate({})).toBeCloseTo(0.16);
    expect(respondRate({ accepts: 3, asks: 5 })).toBeCloseTo(0.4);
    expect(showRate({ shows: 2, accepts: 5 })).toBeCloseTo(0.6);
  });

  it("travel minutes use trafficModel's detour factor and the conditions", () => {
    const minutes = travelMinutes(10, CONDITIONS);
    expect(minutes).toBeCloseTo(((10 * DETOUR_FACTOR) / 30) * 60 * 1.2);
    expect(travelMinutes(10, { ...CONDITIONS, rainFactor: 1.3 })).toBeCloseTo(minutes * 1.3);
  });

  it("rested factor: 1 when never asked, 0.5 right after, full at 14 days", () => {
    expect(restedFactor(null, NOW)).toBe(1);
    expect(restedFactor(NOW, NOW)).toBeCloseTo(0.5);
    expect(restedFactor(new Date(NOW - 7 * DAY_MS), NOW)).toBeCloseTo(0.75);
    expect(restedFactor(new Date(NOW - 28 * DAY_MS), NOW)).toBe(1);
  });

  it("score falls with distance and rises with rest", () => {
    const at = (km, lastAskedAt = null) =>
      donorScore({
        minutes: travelMinutes(km, CONDITIONS),
        urgency: "critical",
        lastAskedAt,
        now: NOW,
      });
    expect(at(1)).toBeGreaterThan(at(5));
    expect(at(5)).toBeGreaterThan(at(20));
    expect(at(5, new Date(NOW - 1 * DAY_MS))).toBeLessThan(at(5, new Date(NOW - 10 * DAY_MS)));
    expect(at(5, new Date(NOW - 10 * DAY_MS))).toBeLessThan(at(5, null));
  });

  it("score is the product of its four factors", () => {
    const score = donorScore({ minutes: 30, urgency: "critical", now: NOW, exact: false });
    expect(score).toBeCloseTo(0.16 * Math.exp(-1) * 1 * GROUP_FIT.compatible);
  });
});

describe("rings, groups and wave size", () => {
  it("ring for wave, reusing the widest after the 4th", () => {
    expect([1, 2, 3, 4, 5, 6].map((wave) => ringForWave("urban", wave))).toEqual([
      5, 10, 15, 25, 25, 25,
    ]);
    expect([1, 4, 6].map((wave) => ringForWave("rural", wave))).toEqual([20, 150, 150]);
  });

  it("groups: exact before wave 3, compatible from wave 3 only when allowed", () => {
    const codes = (request, wave) => groupsForWave(request, wave).map((group) => group.code);
    const request = makeRequest({ group: O_POS, allowCompatible: true });
    expect(codes(request, 1)).toEqual([O_POS]);
    expect(codes(request, 2)).toEqual([O_POS]);
    expect(codes(request, 3)).toEqual([O_POS, O_NEG]);
    expect(codes({ ...request, allowCompatible: false }, 5)).toEqual([O_POS]);
  });

  it("respects the component: plasma accepts other groups than red cells", () => {
    const red = groupsForWave(makeRequest({ group: "11", allowCompatible: true }), 3);
    const plasma = groupsForWave(
      makeRequest({ group: "11", component: "13", allowCompatible: true }),
      3,
    );
    expect(red.map((group) => group.code)).not.toEqual(plasma.map((group) => group.code));
  });

  it("Bombay donors only match Bombay", () => {
    const groups = groupsForWave(makeRequest({ group: "22", allowCompatible: true }), 4);
    expect(groups.every((group) => ["22", "23"].includes(group.code))).toBe(true);
  });

  it("target and size clamps", () => {
    expect(waveTarget(3, "critical")).toBe(5);
    expect(waveTarget(10, "routine")).toBe(13);
    expect(waveSize({ wanted: 5, pAccept: 0.2, urgency: "critical", candidateCount: 100 })).toBe(
      25,
    );
    expect(waveSize({ wanted: 100, pAccept: 0.2, urgency: "critical", candidateCount: 1000 })).toBe(
      40,
    );
    expect(waveSize({ wanted: 100, pAccept: 0.2, urgency: "urgent", candidateCount: 1000 })).toBe(
      25,
    );
    expect(waveSize({ wanted: 1, pAccept: 1, urgency: "routine", candidateCount: 50 })).toBe(3);
    expect(waveSize({ wanted: 5, pAccept: 0.2, urgency: "critical", candidateCount: 7 })).toBe(7);
    expect(waveSize({ wanted: 1, pAccept: 1, urgency: "critical", candidateCount: 2 })).toBe(2);
  });

  it("settings match the plan's table", () => {
    expect(WAVE_SETTINGS.critical).toMatchObject({
      gapMinutes: 10,
      maxWaves: 6,
      cap: 40,
      overbook: 1.5,
    });
    expect(WAVE_SETTINGS.urgent).toMatchObject({
      gapMinutes: 30,
      maxWaves: 4,
      cap: 25,
      overbook: 1.5,
    });
    expect(WAVE_SETTINGS.routine).toMatchObject({
      gapMinutes: 240,
      maxWaves: 3,
      cap: 25,
      overbook: 1.3,
    });
  });
});

describe("quiet hours and snooze (India time)", () => {
  const quiet = { quietStart: "22:00", quietEnd: "07:00" };
  it("crosses midnight, judged from a UTC time", () => {
    expect(inQuietHours(quiet, new Date("2026-11-17T16:29:00Z"))).toBe(false); // 21:59 IST
    expect(inQuietHours(quiet, new Date("2026-11-17T16:30:00Z"))).toBe(true); // 22:00 IST
    expect(inQuietHours(quiet, new Date("2026-11-17T22:00:00Z"))).toBe(true); // 03:30 IST
    expect(inQuietHours(quiet, new Date("2026-11-18T01:29:00Z"))).toBe(true); // 06:59 IST
    expect(inQuietHours(quiet, new Date("2026-11-18T01:30:00Z"))).toBe(false); // 07:00 IST
  });
  it("same-day window and equal start and end", () => {
    expect(
      inQuietHours({ quietStart: "13:00", quietEnd: "15:00" }, new Date("2026-11-18T08:00:00Z")),
    ).toBe(true);
    expect(
      inQuietHours({ quietStart: "13:00", quietEnd: "15:00" }, new Date("2026-11-18T10:00:00Z")),
    ).toBe(false);
    expect(
      inQuietHours({ quietStart: "08:00", quietEnd: "08:00" }, new Date("2026-11-18T02:30:00Z")),
    ).toBe(false);
  });
  it("snooze", () => {
    expect(isSnoozed({ snoozedUntil: new Date(NOW.getTime() + 1000) }, NOW)).toBe(true);
    expect(isSnoozed({ snoozedUntil: new Date(NOW.getTime() - 1000) }, NOW)).toBe(false);
    expect(isSnoozed({ snoozedUntil: null }, NOW)).toBe(false);
  });
});

describe("hard filters", () => {
  const request = makeRequest({ urgency: "urgent" });
  const check = (donor, req = request, wave = 1, now = NOW) =>
    passesHardFilters(donor, req, wave, now);

  it("passes a good donor", () => {
    expect(check(makeDonor("a"))).toEqual({ ok: true, failed: [] });
  });

  const cases = [
    [1, makeDonor("a", 3, { status: { isInNetwork: false } })],
    [2, makeDonor("a", 3, { settings: { isAvailable: false } })],
    [2, makeDonor("a", 3, { settings: { snoozedUntil: new Date(NOW.getTime() + DAY_MS) } })],
    [3, makeDonor("a", 3, { status: { bloodGroupCode: "11" } })],
    [4, makeDonor("a", 3, { status: { eligibleUntil: "2026-11-17" } })],
    [4, makeDonor("a", 3, { status: { eligibleFrom: "2026-11-25" } })],
    [5, makeDonor("a", 3, { status: { screeningConfirmedAt: "2026-08-01T00:00:00Z" } })],
    [5, makeDonor("a", 3, { status: { screeningConfirmedAt: null } })],
    [6, makeDonor("a", 3, { status: { needsStaffCheck: true } })],
    [8, makeDonor("a", 7)],
    [9, makeDonor("a", 3, { top: { lastAskedAt: new Date(NOW - 71 * 3_600_000) } })],
    [9, makeDonor("a", 3, { top: { asksLast7Days: 2 } })],
    [11, makeDonor("a", 3, { top: { alreadyAsked: true } })],
    [12, makeDonor("organizer")],
  ];
  it.each(cases)("rule %i fails alone", (rule, donor) => {
    expect(check(donor)).toEqual({ ok: false, failed: [rule] });
  });

  it("rule 7: apheresis needs willingness", () => {
    const apheresis = makeRequest({ urgency: "urgent", isApheresis: true });
    expect(check(makeDonor("a"), apheresis).failed).toEqual([7]);
    expect(check(makeDonor("a", 3, { settings: { apheresisWilling: true } }), apheresis).ok).toBe(
      true,
    );
  });

  it("rule 10: quiet hours, from a UTC time", () => {
    const night = new Date("2026-11-17T17:00:00Z"); // 22:30 IST
    expect(check(makeDonor("a"), request, 1, night).failed).toEqual([10]);
  });

  it("rule 4 uses India dates: eligible from tomorrow IST still fails today only if after needed-by", () => {
    // 2026-11-18T20:00Z is already 19 Nov in India.
    const late = new Date("2026-11-18T20:00:00Z");
    const donor = makeDonor("a", 3, {
      status: { eligibleUntil: "2026-11-18" },
      settings: { quietStart: "00:00", quietEnd: "00:00" },
    });
    expect(
      check(donor, makeRequest({ urgency: "urgent", neededBy: null }), 1, late).failed,
    ).toEqual([4]);
    expect(check(donor, makeRequest({ urgency: "urgent", neededBy: null }), 1, NOW).ok).toBe(true);
  });

  it("rule 5 counts 90 days on India dates", () => {
    const ninety = makeDonor("a", 3, { status: { screeningConfirmedAt: "2026-08-20T00:00:00Z" } });
    const ninetyOne = makeDonor("a", 3, {
      status: { screeningConfirmedAt: "2026-08-19T00:00:00Z" },
    });
    expect(check(ninety).ok).toBe(true);
    expect(check(ninetyOne).failed).toEqual([5]);
  });

  it("rule 8: either area counts, and the ring grows with the wave", () => {
    const donor = makeDonor("a", 20);
    donor.areas.push({ kind: "work", distanceKm: 4 });
    expect(check(donor).ok).toBe(true);
    expect(check(makeDonor("a", 12), request, 2).failed).toEqual([8]);
    expect(check(makeDonor("a", 12), request, 3).ok).toBe(true);
  });

  it("critical overrides skip rules 9 (gap) and 10 (quiet) only when the donor set them", () => {
    const critical = makeRequest();
    const night = new Date("2026-11-17T17:00:00Z");
    const recent = { lastAskedAt: new Date(night - 10 * 3_600_000) };
    expect(check(makeDonor("a", 3, { top: recent }), critical, 1, night).failed).toEqual([9, 10]);
    const overrides = { criticalOverridesGap: true, criticalOverridesQuiet: true };
    expect(
      check(makeDonor("a", 3, { top: recent, settings: overrides }), critical, 1, night).ok,
    ).toBe(true);
    // Not critical: the settings do nothing.
    expect(
      check(makeDonor("a", 3, { top: recent, settings: overrides }), request, 1, night).failed,
    ).toEqual([9, 10]);
    // The weekly cap is never skipped.
    expect(
      check(makeDonor("a", 3, { top: { asksLast7Days: 2 }, settings: overrides }), critical).failed,
    ).toEqual([9]);
  });

  it("compatible donors pass only from wave 3 when allowed", () => {
    const compatibleRequest = makeRequest({
      urgency: "urgent",
      group: O_POS,
      allowCompatible: true,
    });
    const donor = makeDonor("a", 3);
    expect(check(donor, compatibleRequest, 2).failed).toEqual([3]);
    expect(check(donor, compatibleRequest, 3).ok).toBe(true);
    expect(check(donor, { ...compatibleRequest, allowCompatible: false }, 3).failed).toEqual([3]);
  });
});

describe("planWave", () => {
  it("the plan's worked example: 3 units of O- critical, urban", () => {
    const donors = [...crowd(100, 3, "near"), ...crowd(40, 7, "mid")];
    const first = planWave(makeRequest(), donors, NOW, { seed: 1 });
    expect(first).toMatchObject({ wave: 1, ringKm: 5, target: 5, wanted: 5, k: 25 });
    expect(first.pAccept).toBeCloseTo(0.2);
    expect(first.asks).toHaveLength(25);
    expect(first.asks.every((ask) => ask.donorId.startsWith("near"))).toBe(true);
    expect(first.nextWaveAt).toEqual(new Date(NOW.getTime() + 10 * 60_000));

    const second = planWave(
      makeRequest({ wavesSent: 1, acceptedOnHold: 2 }),
      donors.map((donor) =>
        first.asks.some((ask) => ask.donorId === donor.id)
          ? { ...donor, alreadyAsked: true }
          : donor,
      ),
      NOW,
      { seed: 1 },
    );
    expect(second).toMatchObject({ wave: 2, ringKm: 10, wanted: 3, k: 15 });
    expect(second.asks).toHaveLength(15);
  });

  it("returns nothing when covered, past the last wave, or nothing wanted", () => {
    const donors = crowd(30, 3);
    expect(planWave(makeRequest({ acceptedOnHold: 5 }), donors, NOW, { seed: 1 })).toBeNull();
    expect(planWave(makeRequest({ wavesSent: 6 }), donors, NOW, { seed: 1 })).toBeNull();
    expect(planWave(makeRequest({ unitsDonated: 3 }), donors, NOW, { seed: 1 })).toBeNull();
    expect(
      planWave(makeRequest({ urgency: "routine", wavesSent: 3 }), donors, NOW, { seed: 1 }),
    ).toBeNull();
  });

  it("waves 5 and 6 of a critical request reuse the 25 km ring", () => {
    const donors = crowd(30, 20);
    for (const wavesSent of [4, 5]) {
      const plan = planWave(makeRequest({ wavesSent }), donors, NOW, { seed: 1 });
      expect(plan).toMatchObject({ wave: wavesSent + 1, ringKm: 25 });
      expect(plan.asks.length).toBeGreaterThan(0);
    }
  });

  it("a wave with no candidates still counts, with no asks", () => {
    const plan = planWave(makeRequest(), [], NOW, { seed: 1 });
    expect(plan).toMatchObject({ wave: 1, k: 0, asks: [] });
  });

  it("orders by score, nearer first, and ties by the seed", () => {
    const donors = [makeDonor("far", 4), makeDonor("near", 1), makeDonor("mid", 2.5)];
    const plan = planWave(makeRequest({ unitsNeeded: 1, acceptedOnHold: 0 }), donors, NOW, {
      seed: 3,
    });
    expect(plan.asks.map((ask) => ask.donorId)).toEqual(["near", "mid", "far"]);

    const twins = crowd(10, 3);
    const order = (seed) =>
      planWave(makeRequest({ unitsNeeded: 1 }), twins, NOW, { seed }).asks.map(
        (ask) => ask.donorId,
      );
    expect(order(7)).toEqual(order(7));
    expect(order(7)).toEqual(order(7));
    expect(new Set([1, 2, 3, 4, 5].map((seed) => order(seed).join()))).not.toHaveProperty(
      "size",
      1,
    );
    // The input order does not matter.
    const reversed = [...twins].reverse();
    expect(
      planWave(makeRequest({ unitsNeeded: 1 }), reversed, NOW, { seed: 7 }).asks.map(
        (ask) => ask.donorId,
      ),
    ).toEqual(order(7));
  });

  it("accepts an injected random function", () => {
    const twins = crowd(5, 3);
    const plan = planWave(makeRequest({ unitsNeeded: 1 }), twins, NOW, { random: seededRandom(9) });
    expect(plan.asks).toHaveLength(5);
  });
});

describe("nextRequestStatus", () => {
  const base = (overrides = {}) => ({
    status: "open",
    urgency: "critical",
    unitsNeeded: 3,
    unitsDonated: 0,
    acceptedOnHold: 0,
    wavesSent: 1,
    neededBy: new Date(NOW.getTime() + DAY_MS),
    nextWaveAt: new Date(NOW.getTime() + 600_000),
    ...overrides,
  });

  it("covered at ceil(left x overbook) acceptances, back to open when one drops", () => {
    expect(nextRequestStatus(base({ acceptedOnHold: 5 }), NOW)).toBe("covered");
    expect(nextRequestStatus(base({ status: "covered", acceptedOnHold: 4 }), NOW)).toBe("open");
    expect(nextRequestStatus(base({ acceptedOnHold: 4 }), NOW)).toBe("open");
  });

  it("fulfilled when donated reaches needed, from open or covered", () => {
    expect(nextRequestStatus(base({ unitsDonated: 3 }), NOW)).toBe("fulfilled");
    expect(
      nextRequestStatus(base({ status: "covered", unitsDonated: 3, acceptedOnHold: 5 }), NOW),
    ).toBe("fulfilled");
  });

  it("units donated lower the target", () => {
    expect(nextRequestStatus(base({ unitsDonated: 2, acceptedOnHold: 2 }), NOW)).toBe("covered");
  });

  it("expires at needed-by, partly fulfilled if units came", () => {
    const late = base({ neededBy: new Date(NOW.getTime() - 1) });
    expect(nextRequestStatus(late, NOW)).toBe("expired");
    expect(nextRequestStatus({ ...late, unitsDonated: 1 }, NOW)).toBe("partly_fulfilled");
  });

  it("expires after the last wave plus one gap", () => {
    const lastWave = base({ wavesSent: 6, nextWaveAt: new Date(NOW.getTime() + 1) });
    expect(nextRequestStatus(lastWave, NOW)).toBe("open");
    expect(nextRequestStatus({ ...lastWave, nextWaveAt: NOW }, NOW)).toBe("expired");
    expect(nextRequestStatus({ ...lastWave, nextWaveAt: NOW, unitsDonated: 1 }, NOW)).toBe(
      "partly_fulfilled",
    );
    expect(nextRequestStatus({ ...lastWave, nextWaveAt: NOW, acceptedOnHold: 5 }, NOW)).toBe(
      "covered",
    );
  });

  it("final statuses never change, and cancelled is never produced", () => {
    for (const status of ["fulfilled", "partly_fulfilled", "expired", "cancelled"]) {
      expect(nextRequestStatus(base({ status, acceptedOnHold: 9 }), NOW)).toBe(status);
    }
  });
});
