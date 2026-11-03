// Copies bloodLink's data into a new Supabase project, for the move from Tokyo to
// Mumbai (#28). Both connection strings come from .env.local:
//   SUPABASE_DB_URL         the project in use now, which is only read
//   MUMBAI_SUPABASE_DB_URL  the new project
// Every migration is applied to the new project first (scripts/migrate.mjs). Then
// the tables are copied, in an order the foreign keys allow, inside one transaction
// that is committed only if every count matches. Rows that already exist are
// updated or skipped, so a second run only catches up. Only project refs, table
// names and row counts are printed.
//
// Usage: node scripts/copy-project.mjs           (migrate the new project, then copy)
//        node scripts/copy-project.mjs --check   (compare row counts only)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import pg from "pg";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const sourceUrl = process.env.SUPABASE_DB_URL;
const targetUrl = process.env.MUMBAI_SUPABASE_DB_URL;
if (!sourceUrl || !targetUrl) {
  console.error("Set SUPABASE_DB_URL and MUMBAI_SUPABASE_DB_URL in .env.local.");
  process.exit(1);
}
// The pooler user is "postgres.<project ref>"; the ref is public, unlike the password.
const projectRef = (url) => new URL(url).username.split(".")[1] ?? "?";
if (projectRef(sourceUrl) === projectRef(targetUrl)) {
  console.error("Both connection strings point at the same project.");
  process.exit(1);
}

// [table, primary key, what to do with a row that already exists]. auth.users comes
// first: its trigger creates a bare profile, which the profiles copy then fills in.
// Organizations come before profiles, because profiles.organization_id points at them.
const TABLES = [
  ["auth.users", ["id"], "skip"],
  ["auth.identities", ["id"], "skip"],
  ["public.organizations", ["id"], "update"],
  ["public.profiles", ["id"], "update"],
  ["public.donor_screening", ["user_id"], "update"],
  ["public.audit_log", ["id"], "skip"],
  ["public.blood_banks", ["hospital_code"], "update"],
  ["public.bank_stock_latest", ["hospital_code"], "update"],
  ["public.stock_history", ["hospital_code", "entry_at"], "skip"],
  ["public.upstream_calls", ["id"], "skip"],
];
const PAGE_SIZE = 500;
const quote = (name) => `"${name}"`;

// See migrate.mjs about verifying the pooler's certificate.
const connect = async (url) => {
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
};

async function countRows(client, table) {
  const { rows } = await client.query(`select count(*)::int as n from ${table}`);
  return rows[0].n;
}

// Columns a client may insert (not generated), as { name, isIdentity }, in table order.
async function insertableColumns(client, table) {
  const [schema, name] = table.split(".");
  const { rows } = await client.query(
    `select column_name, identity_generation = 'ALWAYS' as is_identity
     from information_schema.columns
     where table_schema = $1 and table_name = $2 and is_generated = 'NEVER'
     order by ordinal_position`,
    [schema, name],
  );
  return rows.map((row) => ({ name: row.column_name, isIdentity: row.is_identity === true }));
}

async function copyTable(source, target, [table, keyColumns, onExisting]) {
  // The auth tables belong to Supabase and may differ between projects; copy the
  // columns both have.
  const sourceNames = new Set(
    (await insertableColumns(source, table)).map((column) => column.name),
  );
  const columns = (await insertableColumns(target, table)).filter((column) =>
    sourceNames.has(column.name),
  );
  const columnList = columns.map((column) => quote(column.name)).join(", ");
  const hasIdentity = columns.some((column) => column.isIdentity);
  const keyList = keyColumns.map(quote).join(", ");
  const updates = columns
    .filter((column) => !keyColumns.includes(column.name))
    .map((column) => `${quote(column.name)} = excluded.${quote(column.name)}`)
    .join(", ");
  const conflictClause =
    onExisting === "update"
      ? `on conflict (${keyList}) do update set ${updates}`
      : "on conflict do nothing";
  // The app's own triggers would restamp copied rows (updated_at, the consent time),
  // so they are off while public tables are copied. Supabase owns the auth triggers.
  const isPublic = table.startsWith("public.");
  if (isPublic) await target.query(`alter table ${table} disable trigger user`);

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { rows } = await source.query(
      `select coalesce(json_agg(t), '[]'::json) as page
       from (select ${columnList} from ${table} order by ${keyList} limit ${PAGE_SIZE} offset ${offset}) t`,
    );
    const { page } = rows[0];
    if (page.length > 0) {
      await target.query(
        `insert into ${table} (${columnList}) ${hasIdentity ? "overriding system value" : ""}
         select ${columnList} from json_populate_recordset(null::${table}, $1::json)
         ${conflictClause}`,
        [JSON.stringify(page)],
      );
    }
    if (page.length < PAGE_SIZE) break;
  }

  if (isPublic) await target.query(`alter table ${table} enable trigger user`);
  if (hasIdentity) {
    await target.query(
      `select setval(pg_get_serial_sequence('${table}', 'id'), coalesce((select max(id) from ${table}), 0) + 1, false)`,
    );
  }
}

async function compareCounts(source, target) {
  let isMatching = true;
  for (const [table] of TABLES) {
    const [sourceCount, targetCount] = [
      await countRows(source, table),
      await countRows(target, table),
    ];
    if (sourceCount !== targetCount) isMatching = false;
    console.log(
      `${table.padEnd(26)} ${String(sourceCount).padStart(7)} ${String(targetCount).padStart(7)}${sourceCount === targetCount ? "" : "  differs"}`,
    );
  }
  return isMatching;
}

const isCheckOnly = process.argv.includes("--check");
console.log(`from project ${projectRef(sourceUrl)} to project ${projectRef(targetUrl)}`);

if (!isCheckOnly) {
  console.log("Applying migrations to the new project:");
  const migration = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
    env: { ...process.env, SUPABASE_DB_URL: targetUrl },
    stdio: "inherit",
  });
  if (migration.status !== 0) {
    console.error("The migrations failed, so nothing was copied.");
    process.exit(1);
  }
}

const source = await connect(sourceUrl);
const target = await connect(targetUrl);
try {
  // One snapshot of the source, so rows written during the copy can't half appear.
  await source.query("begin transaction isolation level repeatable read read only");
  if (isCheckOnly) {
    console.log(`${"table".padEnd(26)} ${"now".padStart(7)} ${"new".padStart(7)}`);
    process.exitCode = (await compareCounts(source, target)) ? 0 : 1;
  } else {
    await target.query("begin");
    try {
      for (const tableSpec of TABLES) {
        process.stdout.write(`copying ${tableSpec[0]} ... `);
        await copyTable(source, target, tableSpec);
        console.log("done");
      }
      console.log(`${"table".padEnd(26)} ${"now".padStart(7)} ${"new".padStart(7)}`);
      if (!(await compareCounts(source, target))) throw new Error("row counts differ");
      await target.query("commit");
      console.log("Copied. Every count matches.");
    } catch (error) {
      await target.query("rollback");
      console.error(`Nothing was copied: ${error.message}`);
      process.exitCode = 1;
    }
  }
} finally {
  await source.query("rollback").catch(() => {});
  await source.end();
  await target.end();
}
