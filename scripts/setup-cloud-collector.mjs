// Sets up the cloud collector (docs/report3.md, point 3.1) on
// the project in SUPABASE_DB_URL. Needs `npx supabase login` once, and the
// *_cloud_collector.sql migration applied.
//
//   node scripts/setup-cloud-collector.mjs                 new secret, Vault, deploy
//   node scripts/setup-cloud-collector.mjs --deploy-only   redeploy collect-stock only
//   node scripts/setup-cloud-collector.mjs --schedule [interval] [--region <r>|--no-region]
//   node scripts/setup-cloud-collector.mjs --unschedule
//
// The first form, which also rotates the secret:
// 1. creates a random collector secret;
// 2. stores it as the function's COLLECTOR_SECRET and in Vault as collector_secret,
//    with the function's URL as collector_url, for the cron jobs;
// 3. deploys collect-stock with JWT verification off (the secret guards it).
// The secret goes from memory to the CLI and the database, never into a file.
// Scheduling starts nothing at once: the first sweep begins at the next tick.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import pg from "pg";

const SUPABASE_CLI = "supabase@3.0.0";
const args = process.argv.slice(2);
const argValue = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? null);
};

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  console.error("SUPABASE_DB_URL is not set (add it to .env.local).");
  process.exit(1);
}
// The project ref is the pooler user name's suffix, postgres.<ref>.
const ref = decodeURIComponent(new URL(databaseUrl).username).split(".")[1];
const publicHost =
  process.env.NEXT_PUBLIC_SUPABASE_URL && new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
if (!ref || publicHost !== `${ref}.supabase.co`) {
  console.error("SUPABASE_DB_URL and NEXT_PUBLIC_SUPABASE_URL must name the same project.");
  process.exit(1);
}
const functionUrl = `https://${ref}.supabase.co/functions/v1/collect-stock`;

// Runs the Supabase CLI; on Windows npx is a .cmd, which needs a shell. Arguments
// are plain words and base64url, so the shell has nothing to expand.
function supabase(cliArgs) {
  const result = spawnSync("npx", ["--yes", SUPABASE_CLI, ...cliArgs, `--remote=${ref}`, "--yes"], {
    stdio: ["ignore", "inherit", "inherit"],
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(`supabase ${cliArgs[0]} ${cliArgs[1] ?? ""} failed`);
}
const deploy = () =>
  supabase(["functions", "deploy", "collect-stock", "--use-api", "--no-verify-jwt"]);

const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const { rows } = await client.query(
    "select to_regprocedure('public.schedule_stock_collector(interval,text)') is not null as ready",
  );
  if (!rows[0].ready)
    throw new Error("apply the cloud collector migration first (npm run db:migrate)");

  if (args.includes("--deploy-only")) {
    deploy();
  } else if (args.includes("--schedule")) {
    const interval = argValue("--schedule")?.startsWith("--") ? null : argValue("--schedule");
    const region = args.includes("--no-region") ? null : (argValue("--region") ?? "ap-south-1");
    const { rows: scheduled } = await client.query(
      "select public.schedule_stock_collector(coalesce($1::interval, '4 hours 30 minutes'), $2) as jobs",
      [interval, region],
    );
    console.log("scheduled:", scheduled[0].jobs);
    console.log(
      `Every ${interval ?? "4 hours 30 minutes"}, region ${region ?? "default"}; the first sweep starts at the next :05 or :35 India time.`,
    );
  } else if (args.includes("--unschedule")) {
    const { rows: removed } = await client.query("select public.unschedule_stock_collector() as n");
    console.log(`unscheduled ${removed[0].n} job(s)`);
  } else {
    const secret = crypto.randomBytes(32).toString("base64url");
    supabase(["secrets", "set", `COLLECTOR_SECRET=${secret}`]);
    for (const [name, value] of [
      ["collector_url", functionUrl],
      ["collector_secret", secret],
    ]) {
      const { rows: existing } = await client.query(
        "select id from vault.secrets where name = $1",
        [name],
      );
      if (existing.length > 0) {
        await client.query("select vault.update_secret($1, $2)", [existing[0].id, value]);
      } else {
        await client.query("select vault.create_secret($1, $2)", [value, name]);
      }
    }
    console.log(`Vault: collector_url = ${functionUrl}, collector_secret set.`);
    deploy();
    console.log(
      [
        "Set up. Nothing is scheduled yet. To start (Phase 2, after the laptop tasks are disabled):",
        "  node scripts/setup-cloud-collector.mjs --schedule        or, in the SQL editor:",
        "  select public.schedule_stock_collector();",
        "To stop:",
        "  node scripts/setup-cloud-collector.mjs --unschedule      or",
        "  select public.unschedule_stock_collector();",
      ].join("\n"),
    );
  }
} catch (error) {
  console.error(`failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
