import { describe, expect, it } from "vitest";
import {
  exactGroupUnits,
  extractPhone,
  formatUpdatedAgo,
  keepOnlyComponent,
  parseQuantities,
  summarizeStock,
  unitsForComponent,
} from "@/lib/stock";
import { calculateAge, evaluateEligibility } from "@/lib/eligibility";
import { sanitizeDetails } from "@/lib/profile";
import { sanitizeOrganization } from "@/lib/organization";
import { BLOOD_GROUPS, COMPONENTS, getComponentName } from "@/lib/constants";
import { detailsToRows, rowsToDetails } from "@/lib/profileStore";

const NOW = new Date("2026-10-23T12:00:00Z");

describe("stock parsing", () => {
  const bank = {
    components: {
      "Packed Red Blood Cells": { available_WithQty: "O-Ve : 3, A+Ve : 0" },
      Plasma: { available_WithQty: "O-Ve : 2" },
      "Whole Blood": { available_WithQty: "" },
    },
  };
  it("parses groups and units", () => {
    expect(parseQuantities("O-Ve : 3, A+Ve : 86")).toEqual([
      { group: "O-Ve", units: 3 },
      { group: "A+Ve", units: 86 },
    ]);
    expect(parseQuantities("")).toEqual([]);
    expect(parseQuantities(null)).toEqual([]);
  });
  it("counts only matching, non-zero stock", () => {
    expect(summarizeStock(bank).totalUnits).toBe(5);
    expect(summarizeStock(bank, { componentName: "Packed Red Blood Cells" }).totalUnits).toBe(3);
    expect(summarizeStock(bank, { bloodGroupName: "A+Ve" }).totalUnits).toBe(0);
  });
  it("reads one component's units", () => {
    expect(unitsForComponent(bank, "Plasma")).toEqual([{ group: "O-Ve", units: 2 }]);
  });
  // A saved row holds every component. Saifai (1702) lists only plasma, and was
  // once counted as 408 units of A+ red cells when eRaktKosh was down.
  const plasmaOnlyBank = {
    hospitalCode: "1702",
    components: { "Fresh Frozen Plasma": { available_WithQty: "A+Ve : 408, B+Ve : 648" } },
  };
  it("never counts a bank's only component as a different one", () => {
    expect(unitsForComponent(plasmaOnlyBank, "Packed Red Blood Cells")).toEqual([]);
    expect(exactGroupUnits(plasmaOnlyBank, "Packed Red Blood Cells", "A+Ve")).toBe(0);
    expect(
      summarizeStock(plasmaOnlyBank, { componentName: "Packed Red Blood Cells" }).totalUnits,
    ).toBe(0);
    expect(exactGroupUnits(plasmaOnlyBank, "fresh frozen plasma", "A+Ve")).toBe(408);
  });
  it("cuts saved rows down to one component, like a filtered eRaktKosh answer", () => {
    const rows = keepOnlyComponent([bank, plasmaOnlyBank], "Packed Red Blood Cells");
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0].components)).toEqual(["Packed Red Blood Cells"]);
    expect(keepOnlyComponent([plasmaOnlyBank], "Fresh Frozen Plasma")[0].hospitalCode).toBe("1702");
  });
  it("extracts phone numbers and formats update times in Indian time", () => {
    expect(extractPhone("Phone: 9763245312 ,Fax: -, Email: a@b.com")).toBe("9763245312");
    expect(formatUpdatedAgo("2026-10-22 09:00:00", new Date("2026-10-22T05:30:00Z"))).toBe(
      "updated 2 h ago",
    );
  });
  it("loads lookup tables with string codes", () => {
    expect(BLOOD_GROUPS[0].name).toBe("A+Ve");
    expect(COMPONENTS[0].code).toBe("11");
    expect(getComponentName("12")).toBe("Packed Red Blood Cells");
  });
});

describe("eligibility", () => {
  const makeDonor = (overrides = {}, donorDetails = {}) => ({
    isDonor: true,
    dob: "1995-05-01",
    gender: "male",
    ...overrides,
    donorDetails: { ...donorDetails },
  });
  it("handles the main cases", () => {
    expect(evaluateEligibility(makeDonor(), NOW).status).toBe("eligible");
    expect(evaluateEligibility({ isDonor: false }, NOW).status).toBe("not-donor");
    expect(evaluateEligibility(makeDonor({ dob: "2010-01-01" }), NOW).status).toBe("deferred");
    expect(evaluateEligibility(makeDonor({}, { onMedication: true }), NOW).status).toBe("review");
  });
  it("applies the donation gap by gender and gives the next date", () => {
    const result = evaluateEligibility(makeDonor({}, { lastDonationDate: "2026-09-01" }), NOW);
    expect(result.status).toBe("deferred");
    expect(result.nextEligibleDate).toBe("2026-11-30");
    expect(
      evaluateEligibility(makeDonor({ gender: "female" }, { lastDonationDate: "2026-07-01" }), NOW)
        .status,
    ).toBe("deferred");
    expect(evaluateEligibility(makeDonor({}, { lastDonationDate: "2026-07-01" }), NOW).status).toBe(
      "eligible",
    );
  });
  it("respects birthdays", () => {
    expect(calculateAge("2000-10-24", NOW)).toBe(25);
    expect(calculateAge("2000-10-23", NOW)).toBe(26);
  });
});

describe("profile validation and storage mapping", () => {
  const validProfile = {
    fullName: " Asha ",
    dob: "1995-05-01",
    gender: "female",
    phone: "+91 98765 43210",
    stateCode: "30",
    districtCode: "585",
    emergencyContact: { name: "Ravi", phone: "9876543210" },
    isDonor: true,
    bloodGroupId: "16",
    donorDetails: { lastDonationDate: "2026-01-10", recentTattoo: true },
    role: "admin",
  };
  it("accepts and trims a valid profile and drops unknown fields", () => {
    const { errors, details } = sanitizeDetails(validProfile, NOW);
    expect(errors).toEqual([]);
    expect(details.fullName).toBe("Asha");
    expect(details).not.toHaveProperty("role");
  });
  it("rejects bad values", () => {
    const { errors } = sanitizeDetails(
      { ...validProfile, stateCode: "999", bloodGroupId: "99", phone: "abc", dob: "2030-01-01" },
      NOW,
    );
    expect(errors.length).toBeGreaterThanOrEqual(4);
    expect(sanitizeDetails({ ...validProfile, districtCode: "519" }, NOW).errors).toContain(
      "Select a valid district.",
    );
    expect(sanitizeDetails("nonsense", NOW).errors.length).toBeGreaterThan(0);
  });
  it("maps details to table rows and back", () => {
    const { details } = sanitizeDetails(validProfile, NOW);
    const rows = detailsToRows(details);
    expect(rows.profile).toMatchObject({
      full_name: "Asha",
      blood_group_code: "16",
      state_code: "30",
    });
    expect(rows.screening).toMatchObject({ recent_tattoo: true, last_donation_date: "2026-01-10" });
    const roundTrip = rowsToDetails({ ...rows.profile, is_donor: true }, rows.screening);
    expect(roundTrip.donorDetails.recentTattoo).toBe(true);
    expect(roundTrip.bloodGroupId).toBe("16");
  });
});

describe("organization validation", () => {
  const validApplication = {
    kind: "blood_bank",
    name: "City Blood Centre",
    registrationNumber: "BB-123",
    eraktkoshCode: "280167",
    stateCode: "30",
    districtCode: "585",
    address: "1 Main Road, Panaji",
    phone: "0832 222 3333",
  };
  it("accepts a valid application", () => {
    const { errors, row } = sanitizeOrganization(validApplication);
    expect(errors).toEqual([]);
    expect(row).toMatchObject({
      kind: "blood_bank",
      registration_number: "BB-123",
      eraktkosh_code: "280167",
    });
    expect(row).not.toHaveProperty("status");
  });
  it("rejects bad kinds, codes and phones", () => {
    const { errors } = sanitizeOrganization({
      ...validApplication,
      kind: "admin",
      eraktkoshCode: "12ab",
      phone: "x",
    });
    expect(errors.length).toBe(3);
  });
});
