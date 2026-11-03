// Downloads the cloud archive (Storage bucket stock-archive) into the laptop's
// archive folder, in the laptop's own layout, so the history readers
// (../blood_data/scripts/validate_history.py and the forecast scripts) need no change:
//   history/D/NAME.ndjson.gz  -> history/D_NAME.ndjson   one cloud batch's changes
//   history/D.ndjson.gz       -> history/D.ndjson        a laptop day, if missing here
//   sweeps/D/HHMM-bN.json     -> sweeps.ndjson           one line per sweep, its batches merged
//   sweeps.ndjson.gz          -> sweeps.ndjson           the laptop's sweeps, if missing here
//   directory/D.json.gz       -> directory/D.json        if missing here
// D is a UTC date. Only files the laptop lacks are fetched, so one run catches up
// any number of missed weeks. Each file is written under a temporary name and
// renamed when complete, so an interrupted run leaves no half files. The run waits
// up to 10 minutes for the network, then exits 1 so Task Scheduler retries.
// Each run adds a line to sync.log in the archive folder.
//
// Usage: npm run archive:sync [-- --dir ../blood_data/eraktkosh]
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local: the bucket
// is private, so the publishable key can't read it.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "stock-archive";
const PAGE_SIZE = 1000;
const NETWORK_WAIT_MS = 10 * 60_000;
const RETRY_EVERY_MS = 30_000;
// A sweep's four batches go out within 6 minutes; one whose newest batch is older
// than this is complete, and is merged.
const SWEEP_SETTLED_MS = 15 * 60_000;

const args = process.argv.slice(2);
const dirIndex = args.indexOf("--dir");
const archiveDir =
  dirIndex === -1 ? path.join("..", "blood_data", "eraktkosh") : args[dirIndex + 1];
const logFile = path.join(archiveDir, "sync.log");
const writeLog = (text) => {
  console.log(text);
  fs.appendFileSync(logFile, `${new Date().toISOString()} ${text}\n`);
};

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !secretKey || !fs.existsSync(archiveDir)) {
  console.error(
    "Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local, and an existing --dir.",
  );
  process.exit(1);
}
const bucket = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
}).storage.from(BUCKET);

// Every entry under a folder; sub-folders come back with id null.
async function listAll(prefix) {
  const entries = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await bucket.list(prefix, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`list ${prefix || "/"}: ${error.message}`);
    entries.push(...data);
    if (data.length < PAGE_SIZE) return entries;
  }
}
const files = (entries) => entries.filter((entry) => entry.id !== null).map((entry) => entry.name);
const folders = (entries) =>
  entries.filter((entry) => entry.id === null).map((entry) => entry.name);

async function download(objectPath) {
  const { data, error } = await bucket.download(objectPath);
  if (error) throw new Error(`download ${objectPath}: ${error.message}`);
  const bytes = Buffer.from(await data.arrayBuffer());
  return (objectPath.endsWith(".gz") ? zlib.gunzipSync(bytes) : bytes).toString("utf8");
}
function writeAtomic(target, text) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(`${target}.part`, text);
  fs.renameSync(`${target}.part`, target);
}
const lineCount = (text) => text.split("\n").filter((line) => line.trim() !== "").length;

// The first call waits for the network, which is often not up straight after start-up.
async function listRootWhenOnline() {
  const giveUpAt = Date.now() + NETWORK_WAIT_MS;
  for (;;) {
    try {
      return await listAll("");
    } catch (error) {
      if (Date.now() >= giveUpAt) throw error;
      console.log(`waiting for the network (${error.message})`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_EVERY_MS));
    }
  }
}

const counts = { historyFiles: 0, historyRows: 0, sweeps: 0, directory: 0 };
let newestDay = null;
try {
  const root = await listRootWhenOnline();

  // ── history ──
  const historyEntries = folders(root).includes("history") ? await listAll("history") : [];
  const remoteHistory = files(historyEntries).map((name) => [
    `history/${name}`,
    path.join(archiveDir, "history", name.replace(/\.gz$/, "")),
  ]);
  for (const day of folders(historyEntries)) {
    for (const name of files(await listAll(`history/${day}`))) {
      remoteHistory.push([
        `history/${day}/${name}`,
        path.join(archiveDir, "history", `${day}_${name.replace(/\.gz$/, "")}`),
      ]);
    }
  }
  for (const [objectPath, target] of remoteHistory) {
    const day = objectPath.slice(8, 18);
    if (newestDay === null || day > newestDay) newestDay = day;
    if (fs.existsSync(target)) continue;
    const text = await download(objectPath);
    writeAtomic(target, text);
    counts.historyFiles += 1;
    counts.historyRows += lineCount(text);
  }

  // ── sweeps: one line per sweep, as the laptop writes them ──
  const sweepsFile = path.join(archiveDir, "sweeps.ndjson");
  if (!fs.existsSync(sweepsFile) && files(root).includes("sweeps.ndjson.gz")) {
    writeAtomic(sweepsFile, await download("sweeps.ndjson.gz"));
  }
  const existingText = fs.existsSync(sweepsFile) ? fs.readFileSync(sweepsFile, "utf8") : "";
  const mergedSources = new Set(
    existingText
      .split("\n")
      .filter((line) => line.includes('"sources"'))
      .flatMap((line) => JSON.parse(line).sources ?? []),
  );
  const sweepEntries = folders(root).includes("sweeps") ? await listAll("sweeps") : [];
  const newSummaries = [];
  for (const day of folders(sweepEntries)) {
    for (const name of files(await listAll(`sweeps/${day}`))) {
      const source = `${day}/${name.replace(/\.json$/, "")}`;
      if (!mergedSources.has(source))
        newSummaries.push(JSON.parse(await download(`sweeps/${day}/${name}`)));
    }
  }
  const sweepsById = new Map();
  for (const summary of newSummaries) {
    const key = summary.sweepId ?? summary.source;
    sweepsById.set(key, [...(sweepsById.get(key) ?? []), summary]);
  }
  const settledLines = [];
  for (const batches of sweepsById.values()) {
    batches.sort((a, b) => a.batch - b.batch);
    const newestStart = Math.max(...batches.map((batch) => Date.parse(batch.startedAt)));
    if (Date.now() - newestStart < SWEEP_SETTLED_MS) continue; // still running; next time
    settledLines.push({
      startedAt: batches[0].startedAt,
      states: batches.flatMap((batch) => batch.states),
      finishedAt: batches
        .map((batch) => batch.finishedAt)
        .sort()
        .at(-1),
      runner: "edge",
      sweepId: batches[0].sweepId ?? null,
      sources: batches.map((batch) => batch.source),
    });
  }
  if (settledLines.length > 0) {
    settledLines.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const prefix =
      existingText === "" || existingText.endsWith("\n") ? existingText : `${existingText}\n`;
    writeAtomic(
      sweepsFile,
      prefix + settledLines.map((line) => JSON.stringify(line)).join("\n") + "\n",
    );
    counts.sweeps = settledLines.length;
  }

  // ── directory ──
  const directoryEntries = folders(root).includes("directory") ? await listAll("directory") : [];
  for (const name of files(directoryEntries)) {
    const target = path.join(archiveDir, "directory", name.replace(/\.gz$/, ""));
    if (fs.existsSync(target)) continue;
    writeAtomic(target, await download(`directory/${name}`));
    counts.directory += 1;
  }

  writeLog(
    `synced: ${counts.historyFiles} history files (${counts.historyRows} rows), ${counts.sweeps} sweeps, ${counts.directory} directory files; newest day held ${newestDay ?? "none"}`,
  );
} catch (error) {
  writeLog(`failed: ${error.message}`);
  process.exit(1);
}
