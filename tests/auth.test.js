import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth";
import { rpcErrorResponse } from "@/app/api/admin/rpcError";

describe("safeNextPath", () => {
  it("keeps same-site paths with their query and hash", () => {
    expect(safeNextPath("/peer-to-peer")).toBe("/peer-to-peer");
    expect(safeNextPath("/admin/users?role=admin#top")).toBe("/admin/users?role=admin#top");
  });
  it("refuses other sites and anything that isn't a path", () => {
    for (const value of [
      "//evil.com",
      "https://evil.com",
      "evil.com",
      "/\\evil.com",
      "",
      null,
      7,
    ]) {
      expect(safeNextPath(value)).toBe("/");
    }
  });
  // URL parsers drop tabs and newlines, which would turn these into "//evil.com".
  it("refuses tabs and newlines", () => {
    for (const value of ["/\t/evil.com", "/\n/evil.com", "/\r/evil.com"]) {
      expect(safeNextPath(value, "/fallback")).toBe("/fallback");
    }
  });
});

describe("rpcErrorResponse", () => {
  it("maps the one-open-application index to 409", async () => {
    const response = rpcErrorResponse({ code: "23505", message: "duplicate key value" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/pending or approved application/);
  });
  it("keeps the codes the admin functions raise", () => {
    expect(rpcErrorResponse({ code: "42501", message: "Only admins" }).status).toBe(403);
    expect(rpcErrorResponse({ code: "22023", message: "Bad decision" }).status).toBe(400);
    expect(rpcErrorResponse({ code: "P0002", message: "Not found" }).status).toBe(404);
  });
});
