// collect-stock: the cloud collector (#35; docs/report3.md, point 3.1).
// pg_cron's ticks post { batch: 1-4, sweep } and the weekly job posts
// { directory: true, prune: true }; see supabase/migrations/*_cloud_collector.sql.
//
// The collecting is src/lib/collector.js, shared with scripts/snapshot.mjs. This
// file adds the secret check, a pg session as bloodlink_ingest, the time budget
// and the Storage archive. It is deployed with JWT verification off, since the
// cron call carries no user, so the x-collector-secret header is the only way in.
// Deploy with: node scripts/setup-cloud-collector.mjs --deploy-only

import pg from "npm:pg@8.23.1";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import {
  REPEAT_GUARD_MINUTES,
  STATE_BATCHES,
  createCollector,
  isCollectorSecret,
  parseCollectorRequest,
} from "../../../src/lib/collector.js";
import districtData from "../../../assets/district_data.json" with { type: "json" };
import stateBoundaries from "../../../assets/state_boundaries.json" with { type: "json" };

const BUCKET = "stock-archive";
// A free Edge Function may run for 150 s. No state starts after 110 s and no
// eRaktKosh call waits past 135 s, which leaves time for the writes and uploads.
const STOP_STARTING_MS = 110_000;
const CALL_DEADLINE_MS = 135_000;

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// The built-in secret key reaches every table and bucket, so it is used for
// nothing but uploads to stock-archive. Database writes go through bloodlink_ingest.
function archiveBucket() {
  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  if (!secretKeys.default) throw new Error("SUPABASE_SECRET_KEYS has no default key");
  return createClient(Deno.env.get("SUPABASE_URL")!, secretKeys.default, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage.from(BUCKET);
}

async function upload(path: string, body: Uint8Array | string, contentType: string, upsert = false) {
  const { error } = await archiveBucket().upload(path, body, { contentType, upsert });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
}

// "2026-11-10/0535-b1" for batch 1 started at 05:35 UTC on 10 November.
function stampName(time: number, batch: number) {
  const iso = new Date(time).toISOString();
  return `${iso.slice(0, 10)}/${iso.slice(11, 13)}${iso.slice(14, 16)}-b${batch}`;
}

Deno.serve(async (request) => {
  const receivedAt = Date.now();
  if (request.method !== "POST") return respond(405, { error: "POST only" });
  if (
    !isCollectorSecret(request.headers.get("x-collector-secret"), Deno.env.get("COLLECTOR_SECRET"))
  ) {
    return respond(401, { error: "unauthorized" });
  }
  const job = parseCollectorRequest(await request.json().catch(() => null));
  if (job.error) return respond(400, { error: job.error });

  const historyLines: unknown[] = [];
  let directoryAnswer = null as { data: unknown; seenAt: string } | null;
  const client = new pg.Client({ connectionString: Deno.env.get("SUPABASE_DB_URL") });
  // The job in progress, so a fatal error is recorded against it.
  let finishOnError: ((message: string) => Promise<void>) | null = null;
  try {
    await client.connect();
    await client.query("set role bloodlink_ingest");
    const collector = createCollector({
      db: client,
      fetch,
      districtData,
      stateBoundaries,
      archive: {
        history: (lines: unknown[]) => void historyLines.push(...lines),
        directory: (data: unknown, seenAt: string) => void (directoryAnswer = { data, seenAt }),
      },
      runner: "edge",
    });
    const results: Record<string, unknown> = { region: Deno.env.get("SB_REGION") ?? null };
    let status = 200;
    const refuse = (name: string) => {
      results[name] = { refused: `ran in the last ${REPEAT_GUARD_MINUTES} minutes` };
      status = 409;
    };

    if (job.batch) {
      const run = await collector.startRun({
        job: "stock",
        batch: job.batch,
        sweepId: job.sweepId,
        guardMinutes: REPEAT_GUARD_MINUTES,
      });
      if (!run) {
        refuse("batch");
      } else {
        finishOnError = (message) => collector.finishRun(run, { error: message });
        const outcome = await collector.collectStates(STATE_BATCHES[job.batch as 1 | 2 | 3 | 4], {
          stopStartingAt: receivedAt + STOP_STARTING_MS,
          callDeadlineAt: receivedAt + CALL_DEADLINE_MS,
        });
        const name = stampName(receivedAt, job.batch);
        const archived: Record<string, unknown> = { archiveDay: name.slice(0, 10) };
        const errors: string[] = [];
        // The changed rows first: the prune counts them before deleting a day.
        try {
          if (historyLines.length > 0) {
            archived.archivePath = `history/${name}.ndjson.gz`;
            const text = historyLines.map((line) => JSON.stringify(line)).join("\n") + "\n";
            await upload(archived.archivePath as string, await gzip(text), "application/gzip");
          }
          archived.rowsArchived = historyLines.length;
        } catch (error) {
          errors.push((error as Error).message);
        }
        // The batch's summary, which archive:sync merges into one line per sweep.
        try {
          const summary = { ...outcome.sweep, batch: job.batch, sweepId: job.sweepId, source: name };
          await upload(`sweeps/${name}.json`, JSON.stringify(summary), "application/json");
        } catch (error) {
          errors.push((error as Error).message);
        }
        if (errors.length > 0) console.error(errors.join("; "));
        await collector.finishRun(run, { ...outcome, ...archived, error: errors.join("; ") || null });
        finishOnError = null;
        results.batch = {
          batch: job.batch,
          statesSaved: outcome.statesSaved,
          statesFailed: outcome.statesFailed,
          statesSkipped: outcome.statesSkipped,
          rowsChanged: outcome.rowsChanged,
          rowsArchived: archived.rowsArchived ?? null,
          errors,
        };
        if (!outcome.isSuccess || errors.length > 0) status = 500;
      }
    }

    if (job.directory) {
      const run = await collector.startRun({ job: "directory", guardMinutes: REPEAT_GUARD_MINUTES });
      if (!run) {
        refuse("directory");
      } else {
        finishOnError = (message) => collector.finishRun(run, { error: message });
        const outcome = await collector.collectDirectory();
        let error: string | null = outcome.error ?? null;
        if (directoryAnswer) {
          const { data, seenAt } = directoryAnswer;
          try {
            const path = `directory/${seenAt.slice(0, 10)}.json.gz`;
            await upload(path, await gzip(JSON.stringify(data)), "application/gzip", true);
          } catch (uploadError) {
            error = (uploadError as Error).message;
            console.error(error);
          }
        }
        await collector.finishRun(run, { result: outcome.qualityCounts ?? null, error });
        finishOnError = null;
        results.directory = { banks: outcome.banks ?? null, flags: outcome.qualityCounts, error };
        if (error) status = 500;
      }
    }

    if (job.prune) {
      const run = await collector.startRun({ job: "prune", guardMinutes: REPEAT_GUARD_MINUTES });
      if (!run) {
        refuse("prune");
      } else {
        finishOnError = (message) => collector.finishRun(run, { error: message });
        const result = await collector.prune();
        await collector.finishRun(run, { result });
        finishOnError = null;
        results.prune = result;
      }
    }
    return respond(status, results);
  } catch (error) {
    console.error(`fatal: ${(error as Error).message}`);
    await finishOnError?.(`fatal: ${(error as Error).message}`).catch(() => {});
    return respond(500, { error: (error as Error).message });
  } finally {
    await client.end().catch(() => {});
  }
});
