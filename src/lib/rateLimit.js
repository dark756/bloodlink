import { NextResponse } from "next/server";

// Simple per-IP sliding-window limiter kept in server memory.
// Good enough for one server process; on serverless hosts each instance has
// its own memory, so move the counters to the database before relying on it.
//
// The caller's IP is known only when a trusted proxy reports it:
// - On Vercel (VERCEL=1), the platform overwrites X-Forwarded-For with the client's IP.
// - Behind your own proxies, set TRUSTED_PROXY_HOPS to how many of them add to
//   X-Forwarded-For; the client is that many entries from the right.
// Otherwise the header is whatever the client sent (Next.js fills it in only when
// it is missing), so it is ignored and every caller shares one limit.

const MAX_BUCKETS = 5000;
const TRUSTED_PROXY_HOPS =
  process.env.TRUSTED_PROXY_HOPS !== undefined
    ? Number(process.env.TRUSTED_PROXY_HOPS)
    : process.env.VERCEL
      ? 1
      : 0;

// Kept on globalThis so the counters survive hot reloads in development.
const buckets = globalThis._bloodlinkRateBuckets ?? new Map();
globalThis._bloodlinkRateBuckets = buckets;

// The client's IP as the trusted proxies report it, or null when none is trusted.
export function getClientIp(request, proxyHops = TRUSTED_PROXY_HOPS) {
  if (!(proxyHops >= 1)) return null;
  const forwardedFor = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  if (forwardedFor.length === 0) return null;
  return forwardedFor[Math.max(0, forwardedFor.length - proxyHops)];
}

export function checkRateLimit(
  request,
  { key, limit, windowMs, proxyHops = TRUSTED_PROXY_HOPS, now = Date.now() },
) {
  const bucketKey = `${key}:${getClientIp(request, proxyHops) ?? "shared"}`;
  const recentHits = (buckets.get(bucketKey) ?? []).filter((time) => now - time < windowMs);

  if (recentHits.length >= limit) {
    buckets.set(bucketKey, recentHits);
    return { ok: false, retryAfter: Math.ceil((windowMs - (now - recentHits[0])) / 1000) };
  }

  recentHits.push(now);
  buckets.set(bucketKey, recentHits);

  if (buckets.size > MAX_BUCKETS) {
    for (const [existingKey, hitTimes] of buckets) {
      if (hitTimes.every((time) => now - time >= windowMs)) buckets.delete(existingKey);
    }
  }
  return { ok: true };
}

export function tooManyRequests(rateLimitResult) {
  return NextResponse.json(
    { error: "Too many searches in a short time. Please wait a moment and try again." },
    { status: 429, headers: { "Retry-After": String(rateLimitResult.retryAfter) } },
  );
}
