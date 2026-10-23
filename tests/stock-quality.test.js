import { describe, expect, it } from "vitest";
import {
  emptyQualityReport,
  mergeQualityReports,
  validateAvailabilityRows,
} from "@/lib/stockQuality";
import { GROUP_NAMES, isDormant, normalizeGroupName, parseQuantities } from "@/lib/stock";
import { BLOOD_GROUPS } from "@/lib/constants";

// 2026-10-23 12:00 India time.
const NOW = new Date("2026-10-23T06:30:00Z");
const row = (hospitalCode, entrydate, quantities, extra = {}) => ({
  hospitalCode,
  hospitalname: "Blood Centre,",
  hospitaladd: "Main Road, ",
  entrydate,
  components: { "Packed Red Blood Cells": { available_WithQty: quantities } },
  ...extra,
});
const quantitiesOf = (cleanedRow) =>
  cleanedRow.components["Packed Red Blood Cells"].available_WithQty;

describe("group names", () => {
  it("match the lookup table", () => {
    expect([...GROUP_NAMES].sort()).toEqual(BLOOD_GROUPS.map((group) => group.name).sort());
  });
  it("normalise the spellings eRaktKosh uses", () => {
    expect(normalizeGroupName("O +ve")).toBe("O+Ve");
    expect(normalizeGroupName("ab -VE")).toBe("AB-Ve");
    expect(normalizeGroupName("Oh +ve")).toBe("Oh+VE");
    expect(normalizeGroupName("Q+Ve")).toBeNull();
  });
  it("are normalised while parsing, so searches find them", () => {
    expect(parseQuantities("O +ve : 3, A+Ve : 2")).toEqual([
      { group: "O+Ve", units: 3 },
      { group: "A+Ve", units: 2 },
    ]);
  });
});

describe("validateAvailabilityRows", () => {
  it("renames groups and cleans names", () => {
    const { rows, report } = validateAvailabilityRows(
      [row("1", "2026-10-23 10:00:00", "O +ve : 3, B+Ve : 1")],
      { now: NOW },
    );
    expect(quantitiesOf(rows[0])).toBe("O+Ve : 3, B+Ve : 1");
    expect(rows[0].hospitalname).toBe("Blood Centre");
    expect(rows[0].hospitaladd).toBe("Main Road");
    expect(report).toMatchObject({ rowsIn: 1, rowsOut: 1, renamedGroups: 1 });
  });
  it("drops implausible counts, unknown groups and unreadable entries", () => {
    const { rows, report } = validateAvailabilityRows(
      [row("1", "2026-10-23 10:00:00", "O+Ve : 15280, A+Ve : 2.5, Q+Ve : 4, junk, B+Ve : 7")],
      { now: NOW },
    );
    expect(quantitiesOf(rows[0])).toBe("B+Ve : 7");
    expect(report).toMatchObject({ droppedUnitCounts: 2, unknownGroups: 1, unparsedEntries: 1 });
  });
  it("treats an update time in the future as unknown", () => {
    const { rows, report } = validateAvailabilityRows(
      [row("1", "2026-10-23 13:00:00", "O+Ve : 1")],
      { now: NOW },
    );
    expect(rows[0].entrydate).toBeNull();
    expect(report.futureDates).toBe(1);
  });
  it("keeps the newer row when a bank appears twice", () => {
    const { rows, report } = validateAvailabilityRows(
      [
        row("1", "2026-10-22 09:00:00", "O+Ve : 1"),
        row("1", "2026-10-23 09:00:00", "O+Ve : 5"),
        row("2", "2026-10-23 09:00:00", "O+Ve : 2"),
      ],
      { now: NOW },
    );
    expect(rows).toHaveLength(2);
    expect(quantitiesOf(rows.find((cleaned) => cleaned.hospitalCode === "1"))).toBe("O+Ve : 5");
    expect(report.duplicateRows).toBe(1);
  });
  it("skips rows without a bank code and counts dormant banks", () => {
    const { rows, report } = validateAvailabilityRows(
      [row(null, "2026-10-23 09:00:00", "O+Ve : 1"), row("3", "2026-08-01 09:00:00", "O+Ve : 1")],
      { now: NOW },
    );
    expect(rows.map((cleaned) => cleaned.hospitalCode)).toEqual(["3"]);
    expect(report).toMatchObject({ missingCodes: 1, dormantBanks: 1 });
  });
  it("adds reports together", () => {
    const one = { ...emptyQualityReport(), rowsIn: 2, renamedGroups: 1 };
    const two = { ...emptyQualityReport(), rowsIn: 3 };
    expect(mergeQualityReports([one, two])).toMatchObject({ rowsIn: 5, renamedGroups: 1 });
  });
});

describe("dormant stock", () => {
  it("is stock not updated for more than 30 days", () => {
    expect(isDormant("2026-09-22 09:00:00", NOW)).toBe(true);
    expect(isDormant("2026-09-24 09:00:00", NOW)).toBe(false);
    expect(isDormant(null, NOW)).toBe(false);
  });
});
