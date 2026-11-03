// Puts the laptop's local archive into the Storage bucket stock-archive, so the
// cloud archive is complete from 2026-10-23 on (docs/report3.md, point 3.1). Run it
// once the laptop's collector tasks are disabled. It can be re-run
// at any time: files and their records are replaced, never added twice.
//   history/D.ndjson  -> history/D.ndjson.gz   lines recorded in collector_runs
//   sweeps.ndjson     -> sweeps.ndjson.gz
//   directory/D.json  -> directory/D.json.gz
// Each day's lines are recorded as an "upload" run for that UTC day, which the
// prune counts before it deletes the day from stock_history.
//
//   node scripts/upload-archive.mjs [--dir ../blood_data/eraktkosh]
//   node scripts/upload-archive.mjs --check      per UTC day: database rows against
//                                                archived and local lines; changes nothing
//   node scripts/upload-archive.mjs --from-db D  archives day D straight from stock_history,
//                                                for a day --check shows short
// Needs SUPABASE_DB_URL, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { ARCHIVE_VERSION } from "../src/lib/collector.js";

const BUCKET = "stock-archive";
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.ndjson$/;
const DIRECTORY_FILE = /^\d{4}-\d{2}-\d{2}\.json$/;

const args = process.argv.slice(2);
const argValue = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? null);
};
const archiveDir = argValue("--dir") ?? path.join("..", "blood_data", "eraktkosh");
const isCheckOnly = args.includes("--check");
const dbDay = argValue("--from-db");
if (dbDay !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dbDay)) {
  console.error("--from-db takes a UTC date, YYYY-MM-DD.");
  process.exit(1);
}

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const { SUPABASE_DB_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
if (!SUPABASE_DB_URL || !NEXT_PUBLIC_SUPABASE_URL || (!isCheckOnly && !SUPABASE_SECRET_KEY)) {
  console.error(
    "Needs SUPABASE_DB_URL, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local.",
  );
  process.exit(1);
}

const lineCount = (text) => text.split("\n").filter((line) => line.trim() !== "").length;
const localDays = new Map(
  (fs.existsSync(path.join(archiveDir, "history"))
    ? fs.readdirSync(path.join(archiveDir, "history"))
    : []
  )
    .map((name) => name.match(DAY_FILE))
    .filter(Boolean)
    .map((match) => [match[1], path.join(archiveDir, "history", match[0])]),
);

const client = new pg.Client({
  connectionString: SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
await client.query("set role bloodlink_ingest");
const bucket =
  SUPABASE_SECRET_KEY &&
  createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage.from(BUCKET);

async function upload(objectPath, text) {
  const isGzip = objectPath.endsWith(".gz");
  const { error } = await bucket.upload(objectPath, isGzip ? zlib.gzipSync(text) : text, {
    contentType: isGzip ? "application/gzip" : "application/json",
    upsert: true,
  });
  if (error) throw new Error(`upload ${objectPath}: ${error.message}`);
}
// One "upload" run per archived file; re-uploading the file replaces its row.
const recordUpload = (objectPath, day, lines) =>
  client.query(
    `insert into public.collector_runs
       (job, runner, archive_path, archive_day, rows_archived, finished_at)
     values ('upload', 'laptop', $1, $2::date, $3, now())
     on conflict (archive_path) where job = 'upload'
     do update set archive_day = excluded.archive_day, rows_archived = excluded.rows_archived,
       started_at = now(), finished_at = now()`,
    [objectPath, day, lines],
  );

try {
  if (isCheckOnly) {
    const { rows } = await client.query(
      `select d.day::text, d.rows, coalesce(a.lines, 0)::int as archived
       from (select (fetched_at at time zone 'UTC')::date as day, count(*)::int as rows
             from public.stock_history group by 1) d
       left join (select archive_day as day, sum(rows_archived) as lines
                  from public.collector_runs where archive_day is not null group by 1) a using (day)
       order by d.day`,
    );
    let shortDays = 0;
    for (const row of rows) {
      const local = localDays.has(row.day)
        ? lineCount(fs.readFileSync(localDays.get(row.day), "utf8"))
        : "-";
      const isShort = row.archived < row.rows;
      shortDays += isShort ? 1 : 0;
      console.log(
        `${row.day}  database ${String(row.rows).padStart(6)}  archived ${String(row.archived).padStart(6)}  local ${String(local).padStart(6)}${isShort ? "  SHORT" : ""}`,
      );
    }
    console.log(
      shortDays === 0
        ? "Every day is archived in full; the prune may delete any of them once 60 days old."
        : `${shortDays} day(s) short: the prune keeps them. Upload the local files, or use --from-db for a day the laptop lacks.`,
    );
  } else if (dbDay) {
    const { rows } = await client.query(
      `select hospital_code, entry_at, fetched_at, state_code, stock from public.stock_history
       where (fetched_at at time zone 'UTC')::date = $1::date order by fetched_at, hospital_code`,
      [dbDay],
    );
    const text = rows
      .map((row) =>
        JSON.stringify({
          v: ARCHIVE_VERSION,
          fetchedAt: row.fetched_at.toISOString(),
          stateCode: row.state_code,
          hospitalCode: row.hospital_code,
          entryAt: row.entry_at.toISOString(),
          stock: row.stock,
        }),
      )
      .join("\n");
    const objectPath = `history/${dbDay}/db.ndjson.gz`;
    await upload(objectPath, `${text}\n`);
    await recordUpload(objectPath, dbDay, rows.length);
    console.log(`${objectPath}: ${rows.length} rows from stock_history`);
  } else {
    for (const [day, file] of [...localDays].sort()) {
      const text = fs.readFileSync(file, "utf8");
      const objectPath = `history/${day}.ndjson.gz`;
      await upload(objectPath, text);
      await recordUpload(objectPath, day, lineCount(text));
      console.log(`${objectPath}: ${lineCount(text)} lines`);
    }
    const sweepsFile = path.join(archiveDir, "sweeps.ndjson");
    if (fs.existsSync(sweepsFile)) {
      await upload("sweeps.ndjson.gz", fs.readFileSync(sweepsFile, "utf8"));
      console.log("sweeps.ndjson.gz uploaded");
    }
    const directoryDir = path.join(archiveDir, "directory");
    for (const name of fs.existsSync(directoryDir) ? fs.readdirSync(directoryDir) : []) {
      if (!DIRECTORY_FILE.test(name)) continue;
      await upload(`directory/${name}.gz`, fs.readFileSync(path.join(directoryDir, name), "utf8"));
      console.log(`directory/${name}.gz uploaded`);
    }
    console.log("Done. Run with --check to compare every day with the database.");
  }
} catch (error) {
  console.error(`failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
