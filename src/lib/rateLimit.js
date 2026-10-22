import { NextResponse } from "next/server";

// Simple per-IP sliding-window limiter kept in server memory.
// Good enough for one server process; on serverless hosts each instance has
// its own memory, so move the counters to the database before relying on it.

const buckets = globalThis._bloodlinkRateBuckets ?? new Map();
globalThis._bloodlinkRateBuckets = buckets;

function clientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "local";
}

export function checkRateLimit(request, { key, limit, windowMs }) {
  const id = `${key}:${clientIp(request)}`;
  const now = Date.now();
  const hits = (buckets.get(id) ?? []).filter((t) => now - t < windowMs);

  if (hits.length >= limit) {
    buckets.set(id, hits);
    return { ok: false, retryAfter: Math.ceil((windowMs - (now - hits[0])) / 1000) };
  }

  hits.push(now);
  buckets.set(id, hits);

  if (buckets.size > 5000) {
    for (const [bucketId, times] of buckets) {
      if (times.every((t) => now - t >= windowMs)) buckets.delete(bucketId);
    }
  }
  return { ok: true };
}

export function tooManyRequests(result) {
  return NextResponse.json(
    { error: "Too many searches in a short time. Please wait a moment and try again." },
    { status: 429, headers: { "Retry-After": String(result.retryAfter) } }
  );
}
