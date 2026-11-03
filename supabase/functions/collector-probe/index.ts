// collector-probe: Phase 0 of the cloud collector (docs/report3.md, point 3.1). Throwaway; deployed,
// called twice and deleted by scripts/probe-cloud-collector.mjs. It answers:
// - does eRaktKosh answer this function's address (Goa, then Uttar Pradesh, the
//   largest state), and how long does validating it take against the 2 s CPU limit;
// - does SUPABASE_DB_URL connect with npm:pg and allow "set role bloodlink_ingest",
//   and how long is a round trip;
// - which region ran it, and do the shared modules and assets bundle.
// Four eRaktKosh calls per probe run in all.

import pg from "npm:pg@8.23.1";
import { BASE_URL, STATE_BATCHES, isCollectorSecret } from "../../../src/lib/collector.js";
import { validateAvailabilityRows } from "../../../src/lib/stockQuality.js";
import districtData from "../../../assets/district_data.json" with { type: "json" };
import stateBoundaries from "../../../assets/state_boundaries.json" with { type: "json" };

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function fetchState(stateCode: string) {
  const started = performance.now();
  try {
    const response = await fetch(`${BASE_URL}blood-availability?stateCode=${stateCode}`, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    const fetchMs = Math.round(performance.now() - started);
    // Parsing and validating is synchronous, so its wall time is its CPU time.
    const cpuStarted = performance.now();
    let rows = null;
    try {
      rows = validateAvailabilityRows(JSON.parse(text)).report.rowsOut;
    } catch {
      rows = null;
    }
    const parseAndValidateMs = Math.round(performance.now() - cpuStarted);
    return { stateCode, status: response.status, bytes: text.length, rows, fetchMs, parseAndValidateMs };
  } catch (error) {
    return { stateCode, error: (error as Error).name, fetchMs: Math.round(performance.now() - started) };
  }
}

// Tries the connection string as given, then with certificate checks off, as the
// laptop scripts connect (#29). Reports the host and port, never the password.
async function probeDatabase() {
  const databaseUrl = Deno.env.get("SUPABASE_DB_URL") ?? "";
  let host = null;
  try {
    const url = new URL(databaseUrl);
    host = `${url.hostname}:${url.port || 5432} as ${url.username}`;
  } catch {
    host = "unparseable";
  }
  const attempts = [];
  for (const [label, ssl] of [
    ["as given", undefined],
    ["ssl without certificate check", { rejectUnauthorized: false }],
  ] as const) {
    const client = new pg.Client({ connectionString: databaseUrl, ssl });
    const started = performance.now();
    try {
      await client.connect();
      const connectMs = Math.round(performance.now() - started);
      await client.query("set role bloodlink_ingest");
      const roundTrips = [];
      for (let index = 0; index < 3; index += 1) {
        const tripStarted = performance.now();
        await client.query("select count(*) from public.bank_stock_latest where state_code = '30'");
        roundTrips.push(Math.round(performance.now() - tripStarted));
      }
      const { rows } = await client.query("select current_user, inet_server_addr()::text as server");
      attempts.push({ label, ok: true, connectMs, roundTrips, ...rows[0] });
      await client.end();
      break;
    } catch (error) {
      attempts.push({ label, ok: false, error: (error as Error).message });
      await client.end().catch(() => {});
    }
  }
  return { host, attempts };
}

Deno.serve(async (request) => {
  if (!isCollectorSecret(request.headers.get("x-collector-secret"), Deno.env.get("COLLECTOR_PROBE_SECRET"))) {
    return respond(401, { error: "unauthorized" });
  }
  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  const goa = await fetchState("30");
  await new Promise((resolve) => setTimeout(resolve, 1_000)); // one call a second, as always
  const uttarPradesh = await fetchState("99");
  return respond(200, {
    region: Deno.env.get("SB_REGION") ?? null,
    bundled: {
      batches: Object.keys(STATE_BATCHES).length,
      states: districtData.statesWithDistricts.length,
      outlines: Object.keys(stateBoundaries.states).length,
    },
    hasSecretKey: typeof secretKeys.default === "string",
    goa,
    uttarPradesh,
    database: await probeDatabase(),
  });
});
