import { describe, expect, it } from "vitest";
import {
  applyLocationFixes,
  locationFixesEnabled,
  locationVisibility,
  toLocationFix,
} from "@/lib/bankLocations";
import {
  accuracyOf,
  addressParts,
  centroidTraps,
  cleanAddress,
  distinctiveWords,
  extractPin,
  isHealthFacility,
  isPostcode,
  isSpecific,
  meetsAcceptance,
  placeWordsOf,
  quantile,
  searchName,
  seededShuffle,
  sharesDistinctiveWord,
  stateViewbox,
} from "@/lib/bankPlacement";
import { createStateChecker } from "@/lib/stateBounds";
import { haversineMeters } from "@/lib/geo";
import stateBoundaries from "../assets/state_boundaries.json";

const stateChecker = createStateChecker(stateBoundaries);
// A search pin in Mumbai, and a 25 km radius.
const ORIGIN = { latitude: 19.076, longitude: 72.8777 };
const RADIUS_M = 25_000;
const context = { origin: ORIGIN, radiusM: RADIUS_M, stateChecker };
const fix = (overrides = {}) =>
  toLocationFix({
    hospital_code: "1001",
    state_code: "27",
    latitude: 19.1,
    longitude: 72.9,
    method: "nominatim_name",
    precision_m: 800,
    reviewed_at: null,
    ...overrides,
  });
const nearest = (overrides = {}) => ({
  hospitalCode: 1001,
  stateCode: 27,
  latitude: 19.08,
  longitude: 72.88,
  dist: 500,
  ...overrides,
});

describe("applyLocationFixes", () => {
  it("moves a bank whose eRaktKosh point is in another state", () => {
    // Placed in central Delhi, but a Maharashtra bank.
    const wrong = nearest({ latitude: 28.6139, longitude: 77.209, dist: 1_150_000 });
    const { banks, relocated, added } = applyLocationFixes([wrong], [fix()], context);
    expect(relocated).toBe(1);
    expect(added).toBe(0);
    expect(banks[0]).toMatchObject({ latitude: 19.1, longitude: 72.9, locationSource: "fixed" });
    expect(banks[0].locationPrecisionM).toBe(800);
    expect(banks[0].dist).toBeCloseTo(haversineMeters(ORIGIN, { latitude: 19.1, longitude: 72.9 }));
    expect(stateChecker.locationProblem(banks[0])).toBeNull();
  });

  it("adds a fixed bank nearest left out, when its fix is within the radius", () => {
    const { banks, added } = applyLocationFixes([], [fix()], context);
    expect(added).toBe(1);
    expect(banks[0]).toMatchObject({ hospitalCode: 1001, stateCode: 27, locationSource: "fixed" });
  });

  it("leaves out a fix outside the radius, added or moved", () => {
    const far = fix({ latitude: 18.52, longitude: 73.86 }); // Pune, about 120 km away
    expect(applyLocationFixes([], [far], context).banks).toEqual([]);
    const wrong = nearest({ latitude: 28.6139, longitude: 77.209 });
    expect(applyLocationFixes([wrong], [far], context)).toMatchObject({ banks: [], relocated: 0 });
  });

  it("keeps eRaktKosh's usable point over a machine fix", () => {
    const usable = nearest();
    const { banks, relocated } = applyLocationFixes([usable], [fix()], context);
    expect(relocated).toBe(0);
    expect(banks[0]).toBe(usable);
  });

  it("lets a fix a person confirmed win over eRaktKosh's usable point", () => {
    for (const confirmed of [
      fix({ method: "manual" }),
      fix({ reviewed_at: "2026-11-05T10:00:00Z" }),
    ]) {
      const { banks, relocated } = applyLocationFixes([nearest()], [confirmed], context);
      expect(relocated).toBe(1);
      expect(banks[0]).toMatchObject({ latitude: 19.1, longitude: 72.9, locationSource: "fixed" });
    }
  });

  it("returns the answer unchanged when there are no fixes", () => {
    const answer = [nearest(), nearest({ hospitalCode: 1002 })];
    expect(applyLocationFixes(answer, [], context)).toEqual({
      banks: answer,
      relocated: 0,
      added: 0,
    });
  });

  it("drops rows it can't use", () => {
    expect(fix({ latitude: "x" })).toBeNull();
    expect(fix({ hospital_code: "12a" })).toBeNull();
    expect(fix({ method: "guess" })).toBeNull();
    expect(applyLocationFixes([], [null], context).banks).toEqual([]);
  });

  it("is switched off only by BANK_LOCATION_FIXES=off", () => {
    expect(locationFixesEnabled({})).toBe(true);
    expect(locationFixesEnabled({ BANK_LOCATION_FIXES: "on" })).toBe(true);
    expect(locationFixesEnabled({ BANK_LOCATION_FIXES: "OFF" })).toBe(false);
  });

  it("says what location search can do with a stocked bank", () => {
    expect(locationVisibility({ latitude: null, longitude: null })).toBe("missing");
    expect(locationVisibility({ latitude: 1, longitude: 2, locationQuality: "wrong_state" })).toBe(
      "wrong_state",
    );
    expect(locationVisibility({ latitude: 1, longitude: 2, locationQuality: "shared" })).toBe(
      "eraktkosh",
    );
    expect(locationVisibility({ latitude: null, longitude: null, hasFix: true })).toBe("fixed");
  });
});

describe("placing banks: names", () => {
  it("strips blood-bank words to leave the bank or its parent hospital", () => {
    expect(searchName("BSU, CHC Indukurpet")).toBe("CHC Indukurpet");
    expect(searchName("Blood Centre, Sadar Hospital, Koderma")).toBe("Sadar Hospital Koderma");
    expect(searchName("People Tree Hospital Blood Storage Center (Bsu)")).toBe(
      "People Tree Hospital",
    );
    expect(searchName("Uma Medicare Multispeciality Blood Centre")).toBe(
      "Uma Medicare Multispeciality",
    );
  });

  it("keeps only words that can identify a bank", () => {
    const places = placeWordsOf("Maharashtra", "Pune");
    expect([...distinctiveWords("Sassoon General Hospital Pune", places)]).toEqual(["sassoon"]);
    expect(distinctiveWords("District Hospital Pune", places).size).toBe(0);
    expect([...distinctiveWords("I.M.A. Blood Bank, K.E.M.", places)]).toEqual(["kem"]);
  });

  it("needs a distinctive word in common", () => {
    const places = placeWordsOf("Maharashtra", "Pune");
    expect(sharesDistinctiveWord("Sassoon Hospital", "Sassoon General Hospital", places)).toBe(
      true,
    );
    expect(sharesDistinctiveWord("District Hospital Pune", "Pune District Hospital", places)).toBe(
      false,
    );
    expect(sharesDistinctiveWord("Ruby Hall Clinic", "Jehangir Hospital", places)).toBe(false);
  });
});

describe("placing banks: addresses", () => {
  it("finds the PIN code, not part of a phone number", () => {
    expect(extractPin("Rajgir, Nalanda- 803116, Rajgir, Bihar")).toBe("803116");
    expect(extractPin("Main Road, Hyderabad 500 001")).toBe("500001");
    expect(extractPin("Ph 9876543210, Durg, Chhattisgarh")).toBeNull();
    expect(extractPin("Survey No 012345, Anand")).toBeNull();
  });

  it("cleans an address for a geocoder", () => {
    expect(
      cleanAddress("Shree blood centre 1st floor, Station Road, Mob: 9876543210, Durg, , Durg", {
        name: "Shree blood centre",
      }),
    ).toBe("1st floor, Station Road, Durg, Durg");
  });

  it("splits the town from the street, leaving out the district and state", () => {
    const cleaned = cleanAddress("Pound Garden, Kadri, , Mangalore, Dakshina Kannada, Karnataka");
    expect(
      addressParts(cleaned, { stateName: "Karnataka", districtName: "Dakshina Kannada" }),
    ).toEqual({
      street: "Pound Garden, Kadri",
      city: "Mangalore",
    });
    expect(addressParts("Seethampeta, Seethampeta", { stateName: "Andhra Pradesh" })).toEqual({
      street: "Seethampeta",
      city: "Seethampeta",
    });
    expect(addressParts("", {})).toEqual({ street: null, city: null });
  });
});

describe("placing banks: results and accuracy", () => {
  it("reads what a Nominatim result is", () => {
    expect(isHealthFacility({ category: "amenity", type: "hospital" })).toBe(true);
    expect(isHealthFacility({ category: "healthcare", type: "blood_donation" })).toBe(true);
    expect(isHealthFacility({ category: "amenity", type: "school" })).toBe(false);
    expect(isSpecific({ place_rank: 30 })).toBe(true);
    expect(isSpecific({ place_rank: 16 })).toBe(false);
    expect(isPostcode({ addresstype: "postcode" })).toBe(true);
  });

  it("gives a state's viewbox as west,north,east,south", () => {
    expect(stateViewbox({ bbox: [72.6, 15.8, 80.9, 22.0] })).toBe("72.6,22,80.9,15.8");
  });

  it("finds the points too many banks landed on", () => {
    const town = { latitude: 21.1458, longitude: 79.0882 };
    const traps = centroidTraps([town, town, town, town, { latitude: 21.2, longitude: 79.1 }]);
    expect([...traps]).toEqual(["21.1458,79.0882"]);
    expect(centroidTraps([town, town, town]).size).toBe(0);
  });

  it("measures a step's accuracy and applies the rule fixed in advance", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    const good = accuracyOf([100, 200, 300, 400, 500, 600, 700, 800, 900, 1_500], 20);
    expect(good).toMatchObject({ placed: 10, yield: 0.5, falseMatches: 0, accepted: true });
    expect(good.p90M).toBeCloseTo(960);
    const wide = accuracyOf([100, 200, 300, 400, 500, 600, 700, 800, 3_000, 4_000], 10);
    expect(wide.accepted).toBe(false);
    const oneFalse = accuracyOf([...Array(40).fill(100), 12_000], 41);
    expect(oneFalse.falseMatches).toBe(1);
    expect(oneFalse.accepted).toBe(false); // 1 in 41 is 2.4%, over 2%
    expect(meetsAcceptance({ placed: 0, p90M: null, falseMatchRate: null })).toBe(false);
  });

  it("shuffles the same way for the same seed", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(seededShuffle(items, 7)).toEqual(seededShuffle(items, 7));
    expect(seededShuffle(items, 7).sort()).toEqual(items);
  });
});
