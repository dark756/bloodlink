import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateAge, eligibilityWindow, evaluateEligibility } from "@/lib/eligibility";
import { formatDate, formatDateTime } from "@/lib/format";

const { cases } = JSON.parse(
  readFileSync(new URL("./fixtures/eligibility_parity.json", import.meta.url), "utf8"),
);

// An instant on a given India date and clock time.
const at = (day, time) => new Date(`${day}T${time}+05:30`);
const addDays = (day, days) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

function makeDonor(overrides = {}, donorDetails = {}) {
  return {
    isDonor: true,
    dob: "2000-05-10",
    gender: "male",
    donorDetails: {
      lastDonationDate: null,
      recentTattoo: false,
      pregnant: false,
      underweight: false,
      onMedication: false,
      hasDisease: false,
      ...donorDetails,
    },
    ...overrides,
  };
}

describe("eligibilityWindow parity fixture", () => {
  it("has the expected number of cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(25);
  });

  it.each(cases.map((c) => [c.name, c]))("%s", (_name, testCase) => {
    expect(eligibilityWindow(testCase.details, { donations: testCase.donations })).toEqual(
      testCase.expected,
    );
  });
});

describe("age and gap flip at India midnight", () => {
  it("calculateAge flips exactly on the India birthday", () => {
    expect(calculateAge("2008-05-10", at("2026-05-09", "23:59:00"))).toBe(17);
    expect(calculateAge("2008-05-10", at("2026-05-10", "00:01:00"))).toBe(18);
    expect(calculateAge("2008-05-10", new Date("2026-05-09T18:31:00Z"))).toBe(18);
    expect(calculateAge("2008-05-10", new Date("2026-05-09T18:29:00Z"))).toBe(17);
  });

  it("a 29 February birthday flips on 1 March in a non-leap year", () => {
    expect(calculateAge("2008-02-29", at("2026-02-28", "23:59:00"))).toBe(17);
    expect(calculateAge("2008-02-29", at("2026-03-01", "00:01:00"))).toBe(18);
    expect(calculateAge("2008-02-29", at("2028-02-29", "00:01:00"))).toBe(20);
    expect(calculateAge("2008-02-29", at("2028-02-28", "23:59:00"))).toBe(19);
  });

  it("returns null without a usable dob", () => {
    expect(calculateAge("", new Date())).toBeNull();
    expect(calculateAge(null, new Date())).toBeNull();
  });

  it("evaluateEligibility turns eligible at 00:01 India time on the 18th birthday", () => {
    const donor = makeDonor({ dob: "2008-05-10" });
    expect(evaluateEligibility(donor, at("2026-05-09", "23:59:00")).status).toBe("deferred");
    expect(evaluateEligibility(donor, at("2026-05-10", "00:01:00")).status).toBe("eligible");
  });

  it("evaluateEligibility turns eligible on the day the gap ends", () => {
    const donor = makeDonor({}, { lastDonationDate: "2026-01-01" });
    const before = evaluateEligibility(donor, at("2026-03-31", "23:59:00"));
    expect(before.status).toBe("deferred");
    expect(before.nextEligibleDate).toBe("2026-04-01");
    expect(evaluateEligibility(donor, at("2026-04-01", "00:01:00")).status).toBe("eligible");
  });

  it("evaluateEligibility counts days between India dates", () => {
    const donor = makeDonor({}, { lastDonationDate: "2026-01-01" });
    const { reasons } = evaluateEligibility(donor, at("2026-01-11", "00:01:00"));
    expect(reasons[0]).toContain("10 days ago");
  });

  it("evaluateEligibility turns deferred at 00:01 on the 66th birthday", () => {
    const donor = makeDonor({ dob: "1960-06-20" }, { lastDonationDate: "2026-01-01" });
    expect(evaluateEligibility(donor, at("2026-06-19", "23:59:00")).status).toBe("eligible");
    expect(evaluateEligibility(donor, at("2026-06-20", "00:01:00")).status).toBe("deferred");
  });
});

describe("evaluateEligibility agrees with eligibilityWindow", () => {
  const usable = cases.filter(
    (c) =>
      c.donations.length === 0 && c.expected.eligibleFrom !== null && c.details.isDonor === true,
  );

  it("has several cases to loop over", () => {
    expect(usable.length).toBeGreaterThanOrEqual(8);
  });

  it.each(usable.map((c) => [c.name, c]))("%s", (_name, testCase) => {
    const { eligibleFrom, eligibleUntil } = testCase.expected;
    const expectedStatus = testCase.details.donorDetails?.onMedication ? "review" : "eligible";
    const days = [];
    for (let offset = -2; offset <= 2; offset += 1) {
      days.push(addDays(eligibleFrom, offset), addDays(eligibleUntil, offset));
    }
    for (const day of days) {
      const inside = day >= eligibleFrom && day <= eligibleUntil;
      for (const time of ["00:01:00", "23:59:00"]) {
        const { status } = evaluateEligibility(testCase.details, at(day, time));
        expect(status === expectedStatus, `${day} ${time}`).toBe(inside);
        if (!inside) expect(status).toBe("deferred");
      }
    }
  });
});

describe("date formatting is India's calendar", () => {
  it("prints a date-only value as the same calendar date", () => {
    expect(formatDate("2026-01-05")).toBe("5 Jan 2026");
    expect(formatDate("2026-12-31")).toBe("31 Dec 2026");
  });

  it("prints a timestamp in India time", () => {
    expect(formatDate("2026-01-05T20:00:00Z")).toBe("6 Jan 2026");
    expect(formatDateTime("2026-05-09T18:31:00Z")).toMatch(/^10 May 2026, 12:01\s?am$/i);
  });

  it("keeps the empty and invalid cases", () => {
    expect(formatDate("")).toBe("-");
    expect(formatDate("not a date")).toBe("not a date");
  });
});
