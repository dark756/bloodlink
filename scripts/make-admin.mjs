// Bootstraps the first admin. After that, admins manage roles in /admin/users.
// The person must have signed in at least once so their profile exists.
//
// Usage: npm run db:make-admin -- someone@example.com
import fs from "node:fs";
import pg from "pg";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.SUPABASE_DB_URL;
const email = process.argv[2];
if (!databaseUrl || !email) {
  console.error("Usage: npm run db:make-admin -- <email>   (needs SUPABASE_DB_URL in .env.local)");
  process.exit(1);
}

// See migrate.mjs about verifying the pooler's certificate.
const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query("begin");
  const { rows } = await client.query(
    "update public.profiles set role = 'admin' where lower(email) = lower($1) returning id, email",
    [email],
  );
  if (rows.length === 0) {
    await client.query("rollback");
    console.error(`No profile found for ${email}. Sign in once with that account, then retry.`);
    process.exitCode = 1;
  } else {
    const [admin] = rows;
    await client.query(
      "insert into public.audit_log (actor_id, action, target_type, target_id, details) values (null, 'user.role_bootstrap', 'user', $1, $2)",
      [admin.id, JSON.stringify({ to: "admin", via: "scripts/make-admin.mjs" })],
    );
    await client.query("commit");
    console.log(`${admin.email} is now an admin.`);
  }
} finally {
  await client.end();
}
