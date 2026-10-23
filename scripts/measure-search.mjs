// Measures search response times against a running bloodLink server.
//
//   npm run measure -- [--base http://localhost:3000] [--runs 10] [--concurrency 1] [--out file.json]
//
// For each scenario it makes one first request (cold when the server has just
// started), then `runs` more, `concurrency` at a time, and prints the median,
// 95th percentile and maximum. Each simulated user sends its own
// X-Forwarded-For. Start the server with TRUSTED_PROXY_HOPS=1 so it reads that
// header and the per-IP rate limits apply per user, as they would in real use;
// otherwise every request shares one limit and most get 429. Only point it at
// your own server.

import fs from "node:fs";

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const baseUrl = argValue("--base", "http://localhost:3000").replace(/\/$/, "");
const runs = Number(argValue("--runs", "10"));
const concurrency = Number(argValue("--concurrency", "1"));
const outFile = argValue("--out", null);

const SCENARIOS = [
  { name: "Region, Goa (5 banks)", path: "/api/search?stateCode=30" },
  { name: "Region, Uttar Pradesh (678 banks)", path: "/api/search?stateCode=99" },
  {
    name: "Location, Mumbai, PRBC",
    path: "/api/blood-search?lat=19.0760&lng=72.8777&componentId=12",
  },
  {
    name: "Ranked, Mumbai, O- PRBC x3, critical",
    path: "/api/blood-search?lat=19.0760&lng=72.8777&componentId=12&bloodGroupId=16&units=3&urgency=critical",
  },
  {
    name: "Ranked, rural Barmer, O+ PRBC x2, urgent",
    path: "/api/blood-search?lat=25.75&lng=71.39&componentId=12&bloodGroupId=15&units=2&urgency=urgent",
  },
];

const percentile = (sorted, fraction) =>
  sorted.length === 0
    ? null
    : sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];

let userNumber = 0;
async function timedRequest(path) {
  userNumber += 1;
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { "X-Forwarded-For": `10.0.${Math.floor(userNumber / 250)}.${userNumber % 250}` },
    });
    const body = await response.json().catch(() => null);
    const ms = Math.round(performance.now() - started);
    const source = response.headers.get("x-data-source") ?? body?.freshness?.source ?? null;
    return { ms, status: response.status, source };
  } catch (error) {
    return {
      ms: Math.round(performance.now() - started),
      status: 0,
      source: null,
      error: error.message,
    };
  }
}

const results = [];
for (const scenario of SCENARIOS) {
  const first = await timedRequest(scenario.path);
  const samples = [];
  for (let done = 0; done < runs; done += concurrency) {
    const batch = Array.from({ length: Math.min(concurrency, runs - done) }, () =>
      timedRequest(scenario.path),
    );
    samples.push(...(await Promise.all(batch)));
  }
  const times = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  const result = {
    scenario: scenario.name,
    firstMs: first.ms,
    firstSource: first.source,
    runs: samples.length,
    concurrency,
    medianMs: percentile(times, 0.5),
    p95Ms: percentile(times, 0.95),
    maxMs: times.at(-1) ?? null,
    failures: samples.filter((sample) => sample.status !== 200).length,
    statuses: [...new Set(samples.map((sample) => sample.status))],
  };
  results.push(result);
  console.log(
    `${result.scenario.padEnd(42)} first ${String(result.firstMs).padStart(6)} ms (${result.firstSource}) | ` +
      `median ${result.medianMs} p95 ${result.p95Ms} max ${result.maxMs} ms | ` +
      `${result.failures} of ${result.runs} failed`,
  );
}

if (outFile)
  fs.writeFileSync(outFile, JSON.stringify({ baseUrl, runs, concurrency, results }, null, 2));
