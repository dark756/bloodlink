// Checks admins' stock-out events and the extended forecast_marks()
// (supabase/migrations/*_admin_events.sql; docs/PLANS/ML_system.md, Parts B and C) on
// the project in SUPABASE_DB_URL, inside one transaction that is always rolled back.
// Applies the migration first if the project lacks it. The admin checks borrow an
// existing admin's id, and are skipped when there is none; nothing is written to auth.
//
// Usage: node scripts/check-admin-events.mjs
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  console.error("SUPABASE_DB_URL is not set (add it to .env.local).");
  process.exit(1);
}
const migrationFile = fs
  .readdirSync(path.join("supabase", "migrations"))
  .find((fileName) => fileName.endsWith("_admin_events.sql"));
const isLocal = ["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname);
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});
let failures = 0;
const check = (name, isOk, detail = "") => {
  console.log(`${isOk ? "ok  " : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!isOk) failures += 1;
};
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
async function errorCode(sql, params) {
  await client.query("savepoint attempt");
  try {
    await client.query(sql, params);
    await client.query("release savepoint attempt");
    return null;
  } catch (error) {
    await client.query("rollback to savepoint attempt");
    return error.code ?? "error";
  }
}
const asUser = async (userId) => {
  await client.query("reset role");
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
};
const asAnon = async () => {
  await client.query("reset role");
  await client.query("set local role anon");
};
const marks = async (codes, group = "16") =>
  (await one("select public.forecast_marks($1, '12', $2) as answer", [codes, group])).answer;
const create = (code, hours = 48, reason = "Camp cancelled this week, stock is low") =>
  "select public.create_admin_event('" + code + "', '12', '16', " + hours + ", '" + reason + "')";

await client.connect();
try {
  await client.query("begin");
  const version = migrationFile.split("_")[0];
  const { rows: applied } = await client.query(
    "select 1 from supabase_migrations.schema_migrations where version = $1",
    [version],
  );
  if (applied.length === 0) {
    await client.query(fs.readFileSync(path.join("supabase", "migrations", migrationFile), "utf8"));
    console.log(`${migrationFile}: applied inside the transaction`);
  }
  const bank = await one(
    "select hospital_code from public.blood_banks where latitude is not null order by hospital_code limit 1",
  );
  const code = bank.hospital_code;

  // ── non-admins ──
  await asUser("00000000-0000-0000-0000-000000000000");
  check("a non-admin can't create an event", (await errorCode(create(code))) === "42501");
  check("or end one", (await errorCode("select public.end_admin_event(1)")) === "42501");
  const seen = await one("select count(*) as n from public.admin_stock_events");
  check("and sees no events", Number(seen.n) === 0);
  await asAnon();
  check(
    "anon can't read the events table",
    (await errorCode("select 1 from public.admin_stock_events limit 1")) === "42501",
  );

  // ── an admin ──
  await client.query("reset role");
  const admin = await one("select id from public.profiles where role = 'admin' limit 1");
  if (!admin) {
    console.log("skip  the admin checks: no admin in this project");
  } else {
    await asUser(admin.id);
    const { create_admin_event: id } = await one(create(code));
    check("an admin creates an event", Number(id) > 0, `event ${id} at bank ${code}`);
    const event = await one(
      "select window_hours, ends_at - created_at as span, created_by from public.admin_stock_events where id = $1",
      [id],
    );
    check(
      "for the window asked, as its creator",
      event.window_hours === 48 && event.created_by === admin.id,
    );
    check(
      "a second active event for the same group is refused",
      (await errorCode(create(code))) === "22023",
    );
    check(
      "a window other than 24, 48 or 72 h is refused",
      (await errorCode(create(code, 36))) === "22023",
    );
    check(
      "a short reason is refused",
      (await errorCode(create(code, 24, "too short"))) === "22023",
    );
    check("an unknown bank is refused", (await errorCode(create("9999999999"))) === "P0002");
    await client.query("reset role");
    const audit = await one(
      "select count(*) as n from public.audit_log where action = 'stock_event.created' and target_id = $1 and actor_id = $2",
      [String(id), admin.id],
    );
    check("the event is audited with the admin as actor", Number(audit.n) === 1);

    // What search and the suggestions see.
    await client.query("update public.feature_flags set is_enabled = false");
    await asAnon();
    let answer = await marks([code]);
    check(
      "with admin_events off, search sees no event",
      answer.events.length === 0 && !answer.showEvents,
    );
    await client.query("reset role");
    await client.query(
      "update public.feature_flags set is_enabled = true where name = 'admin_events'",
    );
    await asAnon();
    answer = await marks([code]);
    check(
      "with it on, search sees the event, its reason and its end",
      answer.showEvents &&
        answer.events.length === 1 &&
        answer.events[0].reason.startsWith("Camp") &&
        Boolean(answer.events[0].endsAt),
    );
    check("but only for that group", (await marks([code], "15")).events.length === 0);
    check(
      "and no forecast while its flags are off",
      !answer.showBadge && !answer.suggestDonors && answer.marks.length === 0,
    );
    await client.query("reset role");
    await client.query(
      "update public.feature_flags set is_enabled = true where name = 'forecast_appeals'",
    );
    await asAnon();
    answer = await marks([code]);
    check(
      "the suggestions' flag alone turns the forecast's scores on",
      answer.suggestDonors && !answer.showBadge,
    );

    await asUser(admin.id);
    check(
      "the admin ends it",
      (await errorCode("select public.end_admin_event($1)", [id])) === null,
    );
    check("only once", (await errorCode("select public.end_admin_event($1)", [id])) === "P0002");
    await asAnon();
    check("and search no longer sees it", (await marks([code])).events.length === 0);
    await client.query("reset role");
    const ended = await one(
      "select count(*) as n from public.audit_log where action = 'stock_event.ended' and target_id = $1",
      [String(id)],
    );
    check("ending it is audited", Number(ended.n) === 1);
  }
} catch (error) {
  check("the checks", false, error.message);
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
console.log(
  failures === 0
    ? "All checks passed; everything was rolled back."
    : `${failures} check(s) failed; everything was rolled back.`,
);
process.exitCode = failures === 0 ? 0 : 1;
