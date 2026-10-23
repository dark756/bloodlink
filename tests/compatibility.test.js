import { describe, expect, it } from "vitest";
import { componentCategory, donorGroupsFor, parseGroupName } from "@/lib/compatibility";

// eRaktKosh codes: groups 11 A+, 12 A-, 13 B+, 14 B-, 15 O+, 16 O-, 17 AB+, 18 AB-, 22 Oh+, 23 Oh-
// components 11 whole blood, 12 PRBC, 13 FFP, 14 single donor platelet, 17 cryo
const donorGroupNames = (recipientCode, componentCode, options) =>
  donorGroupsFor(recipientCode, componentCode, options).map((group) => group.name);

describe("parseGroupName", () => {
  it("reads ABO and Rh, including Bombay", () => {
    expect(parseGroupName("O-Ve")).toEqual({ abo: "O", rh: "-" });
    expect(parseGroupName("AB+Ve")).toEqual({ abo: "AB", rh: "+" });
    expect(parseGroupName("Oh+VE")).toEqual({ abo: "Oh", rh: "+" });
  });
});

describe("componentCategory", () => {
  it("groups eRaktKosh component codes", () => {
    expect(componentCategory("11")).toBe("whole_blood");
    expect(componentCategory("12")).toBe("red_cells");
    expect(componentCategory("13")).toBe("plasma");
    expect(componentCategory("14")).toBe("platelets");
    expect(componentCategory("99")).toBeNull();
  });
});

describe("red cells", () => {
  it("O- recipients only receive O-", () => {
    expect(donorGroupNames("16", "12")).toEqual(["O-Ve"]);
  });
  it("A+ recipients receive A+, A-, O+ and O-, exact first", () => {
    expect(donorGroupNames("11", "12")).toEqual(["A+Ve", "A-Ve", "O+Ve", "O-Ve"]);
  });
  it("AB+ recipients receive every non-Bombay group", () => {
    expect(donorGroupNames("17", "12")).toHaveLength(8);
    expect(donorGroupNames("17", "12")).not.toContain("Oh+VE");
  });
  it("Rh-negative recipients never receive Rh-positive cells", () => {
    expect(donorGroupNames("18", "12")).toEqual(["AB-Ve", "A-Ve", "B-Ve", "O-Ve"]);
  });
});

describe("whole blood", () => {
  it("needs identical ABO", () => {
    expect(donorGroupNames("11", "11")).toEqual(["A+Ve", "A-Ve"]);
  });
});

describe("plasma", () => {
  it("is the reverse of red cells and ignores Rh", () => {
    expect(donorGroupNames("17", "13")).toEqual(["AB+Ve", "AB-Ve"]);
    expect(donorGroupNames("16", "13")).toHaveLength(8);
  });
  it("applies to cryoprecipitate too", () => {
    expect(donorGroupNames("11", "17")).toEqual(["A+Ve", "A-Ve", "AB+Ve", "AB-Ve"]);
  });
});

describe("platelets", () => {
  it("use plasma ABO rules but keep Rh-negative for Rh-negative recipients", () => {
    expect(donorGroupNames("16", "14")).toEqual(["O-Ve", "A-Ve", "B-Ve", "AB-Ve"]);
  });
});

describe("Bombay group", () => {
  it("Bombay recipients only receive Bombay blood", () => {
    expect(donorGroupNames("23", "12")).toEqual(["Oh-VE"]);
    expect(donorGroupNames("22", "12")).toEqual(["Oh+VE", "Oh-VE"]);
  });
  it("Bombay donors are reserved for Bombay recipients", () => {
    expect(donorGroupNames("17", "13")).not.toContain("Oh+VE");
  });
});

describe("exactOnly", () => {
  it("returns only the recipient's own group", () => {
    expect(donorGroupsFor("11", "12", { exactOnly: true })).toEqual([
      { code: "11", name: "A+Ve", exact: true },
    ]);
  });
});
