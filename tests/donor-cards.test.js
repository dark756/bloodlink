import { describe, expect, it } from "vitest";
import {
  bloodGroupLabel,
  cardState,
  directionsUrl,
  distanceBandText,
  neededByText,
  sanitizeCardAction,
  toCard,
  urgencyLabel,
} from "@/lib/donorCards";

describe("labels", () => {
  it("names urgencies", () => {
    expect(urgencyLabel("critical")).toBe("Critical");
    expect(urgencyLabel("routine")).toBe("Routine");
    expect(urgencyLabel("x")).toBe("Request");
  });

  it("words the distance bands", () => {
    expect(distanceBandText("5")).toBe("Within 5 km");
    expect(distanceBandText("25")).toBe("Within 25 km");
    expect(distanceBandText("beyond")).toBe("More than 25 km away");
    expect(distanceBandText(null)).toBe("More than 25 km away");
  });

  it("falls back to the code for an unknown blood group", () => {
    expect(bloodGroupLabel("zz")).toBe("zz");
    expect(bloodGroupLabel(null)).toBe("");
  });

  it("prints needed-by in India time", () => {
    // 10:00 UTC is 03:30 pm in India.
    expect(neededByText("2026-11-18T10:00:00Z")).toMatch(/18 Nov 2026,? 03:30 pm/i);
    expect(neededByText(null)).toBe("-");
  });
});

describe("cardState", () => {
  it("tells waiting from accepted", () => {
    expect(cardState({ responseStatus: "notified" })).toBe("waiting");
    expect(cardState({ responseStatus: "seen" })).toBe("waiting");
    expect(cardState({ responseStatus: "accepted" })).toBe("accepted");
    expect(cardState({ responseStatus: "declined" })).toBeNull();
    expect(cardState(null)).toBeNull();
  });
});

describe("directionsUrl", () => {
  it("links to the centre's position", () => {
    expect(directionsUrl({ centreLatitude: 19.1, centreLongitude: 72.9 })).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=19.1,72.9",
    );
  });
  it("is null without a position", () => {
    expect(directionsUrl({ centreLatitude: null, centreLongitude: null })).toBeNull();
    expect(directionsUrl({})).toBeNull();
  });
});

describe("toCard", () => {
  it("maps the row and carries no patient field", () => {
    const card = toCard({ request_id: "7", response_status: "notified", centre_name: "A" });
    expect(card.requestId).toBe(7);
    expect(card.centreName).toBe("A");
    expect(Object.keys(card).join()).not.toMatch(/patient/i);
  });
});

describe("sanitizeCardAction", () => {
  it("accepts respond with a boolean", () => {
    expect(sanitizeCardAction({ action: "respond", requestId: 5, accept: true })).toEqual({
      action: "respond",
      requestId: 5,
      accept: true,
    });
    expect(sanitizeCardAction({ action: "respond", requestId: "5", accept: false }).accept).toBe(
      false,
    );
  });
  it("refuses a missing or non-boolean accept", () => {
    expect(sanitizeCardAction({ action: "respond", requestId: 5 }).error).toBeTruthy();
    expect(
      sanitizeCardAction({ action: "respond", requestId: 5, accept: "yes" }).error,
    ).toBeTruthy();
  });
  it("accepts cancel and seen", () => {
    expect(sanitizeCardAction({ action: "cancel", requestId: 5 })).toEqual({
      action: "cancel",
      requestId: 5,
    });
    expect(sanitizeCardAction({ action: "seen", requestId: 5 }).action).toBe("seen");
  });
  it("checks the check-in code", () => {
    expect(sanitizeCardAction({ action: "check_in", requestId: 5, code: " ab12cd " }).code).toBe(
      "AB12CD",
    );
    expect(
      sanitizeCardAction({ action: "check_in", requestId: 5, code: "abc" }).error,
    ).toBeTruthy();
    expect(sanitizeCardAction({ action: "check_in", requestId: 5 }).error).toBeTruthy();
  });
  it("refuses bad ids, actions and bodies", () => {
    for (const requestId of [0, -1, 1.5, "x", null, undefined]) {
      expect(sanitizeCardAction({ action: "seen", requestId }).error).toBeTruthy();
    }
    expect(sanitizeCardAction({ action: "delete", requestId: 1 }).error).toBeTruthy();
    expect(sanitizeCardAction(null).error).toBeTruthy();
    expect(sanitizeCardAction("x").error).toBeTruthy();
  });
});
