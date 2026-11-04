// Checks the bank-location schema (supabase/migrations/*_bank_location_fixes.sql,
// docs/PLANS/plan_bank_locations.md, Part B) on the project in SUPABASE_DB_URL, inside
// one transaction that is always rolled back, so nothing is kept. Applies the migration
// first if the project doesn't have it yet. The checks: what bloodlink_ingest, anon and
// a signed-in non-admin may and may not do, and review_bank_location() as an admin,
// borrowing an existing admin's id (skipped when there is none). Nothing is written to
// the auth schema.
//
// Usage: node scripts/check-location-schema.mjs
import fs from "node:fs";
import pg from "pg";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const sql = fs.readFileSync("supabase/migrations/20261105000100_bank_location_fixes.sql", "utf8");
const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const results = [];
const check = async (label, text, params, expectError = null) => {
  await client.query("savepoint s");
  try {
    const { rows, rowCount } = await client.query(text, params);
    await client.query("release savepoint s");
    results.push([
      expectError ? "FAIL (no error)" : "ok",
      label,
      JSON.stringify(rows?.[0] ?? rowCount),
    ]);
    return rows;
  } catch (error) {
    await client.query("rollback to savepoint s");
    const ok = expectError && new RegExp(expectError).test(`${error.code} ${error.message}`);
    results.push([ok ? "ok" : "FAIL", label, `${error.code} ${error.message}`]);
    return null;
  }
};
try {
  await client.query("begin");
  await client.query("set local statement_timeout = '30s'");
  const { rows: present } = await client.query(
    "select to_regclass('public.bank_location_fixes') is not null as present",
  );
  if (present[0].present) results.push(["ok", "migration already applied", ""]);
  else {
    await client.query(sql);
    results.push(["ok", "migration ran (rolled back at the end)", ""]);
  }

  const [{ hospital_code: missingCode }] = (
    await client.query(`select s.hospital_code from public.bank_stock_latest s
      left join public.blood_banks b using (hospital_code) where b.hospital_code is null limit 1`)
  ).rows;
  const [{ hospital_code: wrongCode }] = (
    await client.query(
      `select hospital_code from public.blood_banks where location_quality = 'wrong_state' limit 1`,
    )
  ).rows;

  // The ingest role.
  await client.query("set local role bloodlink_ingest");
  await check(
    "ingest inserts a proposed machine fix",
    `insert into public.bank_location_fixes (hospital_code, state_code, latitude, longitude, reason, method, precision_m)
     values ($1, '27', 19.07, 72.88, 'missing', 'nominatim_name', 800)`,
    [missingCode],
  );
  await check(
    "ingest upserts it to accepted",
    `insert into public.bank_location_fixes (hospital_code, state_code, latitude, longitude, reason, method, precision_m, status)
     values ($1, '27', 19.08, 72.88, 'missing', 'nominatim_name', 800, 'accepted')
     on conflict (hospital_code) do update set latitude = excluded.latitude, status = excluded.status
     where bank_location_fixes.reviewed_at is null and bank_location_fixes.method not in ('manual', 'bank_confirmed')`,
    [missingCode],
  );
  await check(
    "ingest can't insert a manual fix",
    `insert into public.bank_location_fixes (hospital_code, state_code, latitude, longitude, reason, method, precision_m)
     values ('999999991', '27', 19.07, 72.88, 'missing', 'manual', 50)`,
    [],
    "42501|row-level security",
  );
  await check(
    "ingest marks it superseded",
    `update public.bank_location_fixes set status = 'superseded' where hospital_code = $1 and status = 'accepted'`,
    [missingCode],
  );
  await check(
    "ingest can't delete",
    `delete from public.bank_location_fixes`,
    [],
    "42501|permission denied",
  );
  await client.query("reset role");

  // Anyone (the publishable key) sees accepted fixes only.
  await client.query(`insert into public.bank_location_fixes (hospital_code, state_code, latitude, longitude, reason, method, precision_m, status)
    values ('999999992', '27', 19.1, 72.9, 'missing', 'datagov', 300, 'accepted'),
           ('999999993', '27', 19.1, 72.9, 'missing', 'pincode', 4000, 'proposed')`);
  await client.query("set local role anon");
  await check(
    "anon sees accepted fixes only",
    `select count(*)::int as n, bool_and(status = 'accepted') as all_accepted from public.bank_location_fixes`,
    [],
  );
  await check(
    "anon can't read the queue",
    `select count(*) from public.bank_location_queue`,
    [],
    "42501|permission denied",
  );
  await check(
    "anon can't write",
    `update public.bank_location_fixes set status = 'accepted'`,
    [],
    "42501|permission denied",
  );
  await check(
    "anon can't call the review",
    `select public.review_bank_location($1, 'accepted')`,
    ["999999993"],
    "42501|permission denied",
  );
  await client.query("reset role");

  // A non-admin signed-in user, then an admin, through the function.
  const admin = (await client.query(`select id from public.profiles where role = 'admin' limit 1`))
    .rows[0];
  const user = (await client.query(`select id from public.profiles where role <> 'admin' limit 1`))
    .rows[0];
  const actAs = async (id) => {
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: id, role: "authenticated" }),
    ]);
    await client.query("set local role authenticated");
  };
  if (user) {
    await actAs(user.id);
    await check(
      "a non-admin can't review",
      `select public.review_bank_location($1, 'accepted')`,
      ["999999993"],
      "42501|Only admins",
    );
    await check(
      "a non-admin sees no proposed fix in the queue",
      `select count(*)::int as n from public.bank_location_queue where fix_status = 'proposed'`,
      [],
    );
    await client.query("reset role");
  }
  if (admin) {
    await actAs(admin.id);
    await check(
      "an admin sees the queue",
      `select count(*)::int as banks, count(*) filter (where fix_status = 'proposed')::int as proposed from public.bank_location_queue`,
      [],
    );
    await check(
      "an admin accepts a proposal",
      `select public.review_bank_location($1, 'accepted')`,
      ["999999993"],
    );
    await check(
      "an admin moves a wrong-state bank's pin",
      `select public.review_bank_location($1, 'moved', 19.2, 72.95, 'checked by phone')`,
      [wrongCode],
    );
    await check(
      "an admin marks a missing bank can't place",
      `select public.review_bank_location($1, 'cant_place', null, null, 'no address')`,
      [missingCode],
    );
    await check(
      "a bad decision is refused",
      `select public.review_bank_location($1, 'maybe')`,
      [wrongCode],
      "22023",
    );
    await check(
      "a pin outside India is refused",
      `select public.review_bank_location($1, 'moved', 1, 1)`,
      [wrongCode],
      "22023",
    );
    await client.query("reset role");
    await check(
      "the moved pin is a manual, accepted, reviewed fix",
      `select method, status, reason, reviewed_by is not null as reviewed, precision_m from public.bank_location_fixes where hospital_code = $1`,
      [wrongCode],
    );
    await check(
      "the audit log has the three decisions",
      `select count(*)::int as n from public.audit_log where action like 'bank_location.%' and created_at > now() - interval '1 minute'`,
      [],
    );
    // The ingest role can't overwrite what the admin did.
    await client.query("set local role bloodlink_ingest");
    await check(
      "ingest can't touch a reviewed fix",
      `update public.bank_location_fixes set status = 'superseded' where hospital_code = $1`,
      [wrongCode],
    );
    await client.query("reset role");
    await check(
      "the reviewed fix is unchanged",
      `select status from public.bank_location_fixes where hospital_code = $1`,
      [wrongCode],
    );
  } else {
    results.push(["skip", "no admin profile to act as", ""]);
  }
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
for (const [verdict, label, detail] of results)
  console.log(`${verdict.padEnd(16)} ${label}  ${detail}`);
console.log(
  results.some(([v]) => v.startsWith("FAIL"))
    ? "SOME CHECKS FAILED"
    : "all checks passed; everything rolled back",
);
