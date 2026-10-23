// Applies supabase/migrations/*.sql to the database in SUPABASE_DB_URL, in order,
// each in its own transaction. Applied versions are recorded in
// supabase_migrations.schema_migrations, the same table the Supabase CLI uses,
// so `supabase db push` will also see them.
//
// Usage: npm run db:migrate            (apply pending migrations)
//        npm run db:migrate -- --status (list applied and pending)
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  console.error("SUPABASE_DB_URL is not set (add it to .env.local).");
  process.exit(1);
}

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const migrationFiles = fs
  .readdirSync(migrationsDir)
  .filter((fileName) => /^\d+_.+\.sql$/.test(fileName))
  .sort();

// The Supabase pooler uses TLS with Supabase's own CA. To verify it, download the
// CA certificate from Dashboard > Database > SSL and pass it as ssl.ca instead.
const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  await client.query(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key, statements text[], name text
    );`);
  const { rows } = await client.query("select version from supabase_migrations.schema_migrations");
  const appliedVersions = new Set(rows.map((row) => row.version));

  if (process.argv.includes("--status")) {
    for (const fileName of migrationFiles) {
      const version = fileName.split("_")[0];
      console.log(`${appliedVersions.has(version) ? "applied" : "pending"}  ${fileName}`);
    }
  } else {
    let appliedCount = 0;
    for (const fileName of migrationFiles) {
      const [version, ...nameParts] = fileName.replace(/\.sql$/, "").split("_");
      if (appliedVersions.has(version)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, fileName), "utf8");
      process.stdout.write(`applying ${fileName} ... `);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)",
          [version, nameParts.join("_"), [sql]],
        );
        await client.query("commit");
        console.log("done");
        appliedCount += 1;
      } catch (error) {
        await client.query("rollback");
        console.log("FAILED");
        throw error;
      }
    }
    console.log(
      appliedCount === 0 ? "Database is up to date." : `Applied ${appliedCount} migration(s).`,
    );
  }
} finally {
  await client.end();
}
