import { describe, expect, it } from "vitest";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

const requestFrom = (forwardedFor) =>
  new Request("http://localhost/api/blood-search", {
    headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
  });

describe("client IP", () => {
  it("ignores X-Forwarded-For unless a trusted proxy sets it", () => {
    expect(getClientIp(requestFrom("10.0.0.1"), 0)).toBeNull();
  });
  it("reads the entry the trusted proxies added, not what the client sent", () => {
    expect(getClientIp(requestFrom("203.0.113.9"), 1)).toBe("203.0.113.9");
    // The client sent 6.6.6.6; one proxy appended the real address.
    expect(getClientIp(requestFrom("6.6.6.6, 203.0.113.9"), 1)).toBe("203.0.113.9");
    expect(getClientIp(requestFrom("6.6.6.6, 203.0.113.9, 10.0.0.2"), 2)).toBe("203.0.113.9");
    expect(getClientIp(requestFrom(null), 1)).toBeNull();
  });
});

describe("rate limit", () => {
  const options = { limit: 2, windowMs: 60_000, now: 1_000_000 };
  it("can't be dodged with a new X-Forwarded-For when no proxy is trusted", () => {
    const results = ["1.1.1.1", "2.2.2.2", "3.3.3.3"].map((address) =>
      checkRateLimit(requestFrom(address), { ...options, key: "test-spoof", proxyHops: 0 }),
    );
    expect(results.map((result) => result.ok)).toEqual([true, true, false]);
    expect(results[2].retryAfter).toBe(60);
  });
  it("counts each client apart behind a trusted proxy", () => {
    const results = ["1.1.1.1", "2.2.2.2", "3.3.3.3"].map((address) =>
      checkRateLimit(requestFrom(address), { ...options, key: "test-proxy", proxyHops: 1 }),
    );
    expect(results.every((result) => result.ok)).toBe(true);
  });
});
