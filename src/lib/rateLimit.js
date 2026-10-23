import { NextResponse } from "next/server";

// Simple per-IP sliding-window limiter kept in server memory.
// Good enough for one server process; on serverless hosts each instance has
// its own memory, so move the counters to the database before relying on it.

const MAX_BUCKETS = 5000;

// Kept on globalThis so the counters survive hot reloads in development.
const buckets = globalThis._bloodlinkRateBuckets ?? new Map();
globalThis._bloodlinkRateBuckets = buckets;

function getClientIp(request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "local";
}

export function checkRateLimit(request, { key, limit, windowMs }) {
  const bucketKey = `${key}:${getClientIp(request)}`;
  const now = Date.now();
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
