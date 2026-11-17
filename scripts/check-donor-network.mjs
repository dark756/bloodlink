// Checks the donor network's schema (supabase/migrations/*_donor_network.sql,
// docs/PLANS/plan_donor_network.md, "Data model" and "Eligibility inside the database") on the
// project in SUPABASE_DB_URL, inside one transaction that is always rolled back, so nothing is
// kept: tables, grants and row-level security as a signed-in donor, the consent functions, the
// status triggers, donor_cell_counts() and delete_my_account(). Throwaway users are inserted
// into auth.users inside the transaction; the rollback removes them. Applies the migration
// first if the project doesn't have it yet. Every case in tests/fixtures/eligibility_parity.json
// is also run through the database's eligibility window and compared with the expected dates, so
// the SQL and src/lib/eligibility.js can't drift apart.
//
// Usage: node scripts/check-donor-network.mjs
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  console.error("SUPABASE_DB_URL is not set (add it to .env.local).");
  process.exit(1);
}
const FIXTURE_FILE = path.join("tests", "fixtures", "eligibility_parity.json");
const migrationFile = fs
  .readdirSync(path.join("supabase", "migrations"))
  .find((fileName) => fileName.endsWith("_donor_network.sql"));
const isLocal = ["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname);
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

let total = 0;
let failures = 0;
const check = (name, isOk, detail = "") => {
  total += 1;
  if (!isOk) failures += 1;
  const number = String(total).padStart(3, "0");
  console.log(`${isOk ? "PASS" : "FAIL"} ${number}  ${name}${detail ? `  (${detail})` : ""}`);
};
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const count = async (sql, params) => Number((await one(sql, params)).n);
// The SQLSTATE a statement fails with, or null when it succeeds. A savepoint keeps the
// transaction usable afterwards.
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
const asPostgres = async () => {
  await client.query("reset role");
};
const asUser = async (userId) => {
  await client.query("reset role");
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
};
const asSignedOut = async () => {
  await client.query("reset role");
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claims', '', true)");
};
const asAnon = async () => {
  await client.query("reset role");
  await client.query("set local role anon");
};

// A throwaway auth user; the on_auth_user_created trigger makes its profile. Runs as the
// connecting role. `complete` fills what is_profile_complete needs.
let userCounter = 0;
async function makeUser({
  complete = true,
  donor = true,
  dob = "1995-06-15",
  gender = "male",
} = {}) {
  await asPostgres();
  const id = crypto.randomUUID();
  userCounter += 1;
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    id,
    `donor-network-check-${userCounter}-${id.slice(0, 8)}@example.invalid`,
  ]);
  if (complete) {
    await client.query(
      `update public.profiles set full_name = 'Check Donor', dob = $2, gender = $3,
         phone = '+911234567890', state_code = '27', blood_group_code = '15', is_donor = $4
       where id = $1`,
      [id, dob, gender, donor],
    );
  } else {
    await client.query("update public.profiles set is_donor = $2 where id = $1", [id, donor]);
  }
  return id;
}
const statusOf = (id) =>
  one(
    `select is_in_network, eligible_from::text as eligible_from, eligible_until::text as eligible_until,
            needs_staff_check, screening_confirmed_at, blood_group_code
     from public.donor_status where user_id = $1`,
    [id],
  );
const openConsent = (id, purpose = "donor_network") =>
  count(
    "select count(*) as n from public.consents where user_id = $1 and purpose = $2 and withdrawn_at is null",
    [id, purpose],
  );
const NOTICE = "2026-11-17";
const SETTINGS_INSERT =
  "insert into public.donor_settings (user_id, max_requests_per_week, channels) values ($1, $2, $3)";
const AREA_INSERT =
  "insert into public.donor_areas (user_id, kind, latitude, longitude) values ($1, $2, $3, $4)";

await client.connect();
try {
  await client.query("begin");
  await client.query("set local lock_timeout = '5s'");
  await client.query("set local statement_timeout = '60s'");
  const version = migrationFile.split("_")[0];
  const { rows: applied } = await client.query(
    "select 1 from supabase_migrations.schema_migrations where version = $1",
    [version],
  );
  if (applied.length === 0) {
    await client.query(fs.readFileSync(path.join("supabase", "migrations", migrationFile), "utf8"));
    console.log(`${migrationFile}: applied inside the transaction`);
  } else {
    console.log(`${migrationFile}: already applied; checking the live objects`);
  }

  // ── schema ──
  const tables = ["consents", "donor_settings", "donor_areas", "donations", "donor_status"];
  const { rows: rlsRows } = await client.query(
    `select relname, relrowsecurity from pg_class
     where relnamespace = 'public'::regnamespace and relname = any($1)`,
    [tables],
  );
  check(
    "the five tables exist with row-level security on",
    rlsRows.length === 5 && rlsRows.every((row) => row.relrowsecurity),
  );
  const columnsOf = async (table) =>
    (
      await client.query(
        "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1",
        [table],
      )
    ).rows.map((row) => row.column_name);
  const expectedColumns = {
    consents: ["id", "user_id", "purpose", "notice_version", "given_at", "withdrawn_at"],
    donor_settings: [
      "user_id",
      "is_available",
      "snoozed_until",
      "quiet_start",
      "quiet_end",
      "critical_overrides_quiet",
      "critical_overrides_gap",
      "max_requests_per_week",
      "apheresis_willing",
      "channels",
      "updated_at",
    ],
    donor_areas: ["user_id", "kind", "latitude", "longitude", "cell", "updated_at"],
    donations: [
      "id",
      "donor_id",
      "organization_id",
      "donated_on",
      "kind",
      "request_id",
      "source",
      "created_at",
    ],
    donor_status: [
      "user_id",
      "blood_group_code",
      "is_in_network",
      "eligible_from",
      "eligible_until",
      "needs_staff_check",
      "screening_confirmed_at",
      "asks_total",
      "accepts_total",
      "shows_total",
      "ignored_in_a_row",
      "last_asked_at",
      "updated_at",
    ],
  };
  for (const [table, expected] of Object.entries(expectedColumns)) {
    const actual = await columnsOf(table);
    const missing = expected.filter((column) => !actual.includes(column));
    check(
      `${table} has its columns`,
      missing.length === 0 && actual.length === expected.length,
      missing.length ? `missing ${missing.join(", ")}` : `${actual.length} columns`,
    );
  }
  check(
    "profiles.is_suspended exists, not null, default false",
    (
      await one(
        `select is_nullable, column_default from information_schema.columns
         where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_suspended'`,
      )
    )?.is_nullable === "NO",
  );
  const gist = await count(
    `select count(*) as n from pg_indexes where schemaname = 'public' and tablename = 'donor_areas'
       and indexdef ilike '%using gist (cell)%'`,
  );
  check("donor_areas has a GiST index on the cell", gist === 1);
  const partial = await count(
    `select count(*) as n from pg_indexes where schemaname = 'public' and tablename = 'donor_status'
       and indexdef ilike '%(blood_group_code)%where%is_in_network%'`,
  );
  check("donor_status has the partial group index", partial === 1);
  const consentIndex = await count(
    `select count(*) as n from pg_indexes where schemaname = 'public' and tablename = 'consents'
       and indexdef ilike 'create unique index%(user_id, purpose)%withdrawn_at is null%'`,
  );
  check("consents allow one open row per user and purpose", consentIndex === 1);
  const anonGrants = await count(
    `select count(*) as n from information_schema.role_table_grants
     where table_schema = 'public' and table_name = any($1) and grantee = 'anon'`,
    [tables],
  );
  check("anon has no grant on any of them", anonGrants === 0);

  // ── people ──
  const alice = await makeUser();
  const bob = await makeUser();
  const incomplete = await makeUser({ complete: false });
  const nonDonor = await makeUser({ donor: false });
  const admin = await makeUser();
  await client.query("update public.profiles set role = 'admin' where id = $1", [admin]);

  check(
    "a new profile gets a status row, outside the network",
    (await statusOf(alice))?.is_in_network === false,
  );

  // ── consent functions ──
  await asSignedOut();
  check(
    "give_consent with no signed-in user is refused (42501)",
    (await errorCode("select public.give_consent('donor_network', $1)", [NOTICE])) === "42501",
  );
  await asAnon();
  check(
    "anon can't call give_consent (42501)",
    (await errorCode("select public.give_consent('donor_network', $1)", [NOTICE])) === "42501",
  );
  check(
    "or withdraw_consent (42501)",
    (await errorCode("select public.withdraw_consent('donor_network')")) === "42501",
  );
  await asSignedOut();
  check(
    "withdraw_consent with no signed-in user is refused (42501)",
    (await errorCode("select public.withdraw_consent('donor_network')")) === "42501",
  );
  await asUser(incomplete);
  check(
    "an incomplete profile can't join (22023)",
    (await errorCode("select public.give_consent('donor_network', $1)", [NOTICE])) === "22023",
  );
  await asUser(nonDonor);
  check(
    "a profile that isn't a donor can't join (22023)",
    (await errorCode("select public.give_consent('donor_network', $1)", [NOTICE])) === "22023",
  );
  await asUser(alice);
  check(
    "an unknown purpose is refused (22023)",
    (await errorCode("select public.give_consent('newsletter', $1)", [NOTICE])) === "22023",
  );
  check(
    "a notice version that isn't a date is refused (22023)",
    (await errorCode("select public.give_consent('donor_network', 'v1')")) === "22023",
  );

  // Settings and areas need the consent first.
  check(
    "settings are refused without consent (42501)",
    (await errorCode(SETTINGS_INSERT, [alice, 2, "{in_app}"])) === "42501",
  );
  check(
    "areas are refused without consent (42501)",
    (await errorCode(AREA_INSERT, [alice, "home", 19.07, 72.88])) === "42501",
  );
  check(
    "alice joins",
    (await errorCode("select public.give_consent('donor_network', $1)", [NOTICE])) === null,
  );
  await asPostgres();
  check("one open consent row", (await openConsent(alice)) === 1);
  check("and she is in the network", (await statusOf(alice)).is_in_network === true);
  await asUser(alice);
  await client.query("select public.give_consent('donor_network', $1)", [NOTICE]);
  await asPostgres();
  check(
    "the same version again changes nothing",
    (await count("select count(*) as n from public.consents where user_id = $1", [alice])) === 1,
  );
  await asUser(alice);
  await client.query("select public.give_consent('donor_network', '2026-12-01')");
  await asPostgres();
  const rows = (
    await client.query(
      "select notice_version, withdrawn_at is null as is_open from public.consents where user_id = $1 order by id",
      [alice],
    )
  ).rows;
  check(
    "a new version closes the old row and opens a new one",
    rows.length === 2 &&
      rows[0].is_open === false &&
      rows[1].is_open === true &&
      rows[1].notice_version === "2026-12-01",
  );
  await asUser(bob);
  await client.query("select public.give_consent('donor_network', $1)", [NOTICE]);
  await client.query("select public.give_consent('sms', $1)", [NOTICE]);

  // ── as a donor: reads and writes ──
  await asUser(alice);
  check(
    "settings insert once consented",
    (await errorCode(SETTINGS_INSERT, [alice, 3, "{in_app,email}"])) === null,
  );
  check(
    "areas insert once consented (home and work)",
    (await errorCode(AREA_INSERT, [alice, "home", 19.0761, 72.8777])) === null &&
      (await errorCode(AREA_INSERT, [alice, "work", 19.1, 72.9])) === null,
  );
  const home = await one(
    `select latitude::text as latitude, longitude::text as longitude, cell is not null as has_cell
     from public.donor_areas where user_id = $1 and kind = 'home'`,
    [alice],
  );
  check(
    "an area is rounded to 2 decimals and has a point",
    home.latitude === "19.08" && home.longitude === "72.88" && home.has_cell,
  );
  await asUser(bob);
  check(
    "bob can save settings and an area too",
    (await errorCode(SETTINGS_INSERT, [bob, 2, "{push}"])) === null &&
      (await errorCode(AREA_INSERT, [bob, "home", 28.61, 77.21])) === null,
  );
  await asUser(alice);
  check(
    "alice reads her own settings, areas, status and consents",
    (await count("select count(*) as n from public.donor_settings")) === 1 &&
      (await count("select count(*) as n from public.donor_areas")) === 2 &&
      (await count("select count(*) as n from public.donor_status")) === 1 &&
      (await count("select count(*) as n from public.consents")) === 2,
  );
  check(
    "and none of bob's",
    (await count("select count(*) as n from public.donor_settings where user_id = $1", [bob])) ===
      0 &&
      (await count("select count(*) as n from public.donor_areas where user_id = $1", [bob])) ===
        0 &&
      (await count("select count(*) as n from public.donor_status where user_id = $1", [bob])) ===
        0 &&
      (await count("select count(*) as n from public.consents where user_id = $1", [bob])) === 0,
  );
  check(
    "her update of bob's settings changes nothing",
    (await errorCode("update public.donor_settings set is_available = false where user_id = $1", [
      bob,
    ])) === null &&
      (await count(
        "select count(*) as n from public.donor_settings where user_id = $1 and is_available = false",
        [bob],
      )) === 0,
  );
  check(
    "or insert settings as bob (42501)",
    (await errorCode(SETTINGS_INSERT, [bob, 2, "{push}"])) === "42501",
  );
  check(
    "she updates her own settings",
    (await errorCode(
      "update public.donor_settings set is_available = false, max_requests_per_week = 7",
    )) === null,
  );
  check(
    "but not updated_at (42501)",
    (await errorCode("update public.donor_settings set updated_at = now()")) === "42501",
  );
  check(
    "or the generated cell",
    (await errorCode("update public.donor_areas set cell = null")) !== null,
  );
  check(
    "donor_status isn't writable (42501)",
    (await errorCode("update public.donor_status set is_in_network = false")) === "42501" &&
      (await errorCode("insert into public.donor_status (user_id) values ($1)", [bob])) ===
        "42501" &&
      (await errorCode("delete from public.donor_status")) === "42501",
  );
  check(
    "donations aren't writable (42501)",
    (await errorCode(
      "insert into public.donations (donor_id, donated_on, kind) values ($1, '2026-01-01', 'whole_blood')",
      [alice],
    )) === "42501",
  );
  check(
    "consents aren't writable (42501)",
    (await errorCode(
      "insert into public.consents (user_id, purpose, notice_version) values ($1, 'sms', $2)",
      [alice, NOTICE],
    )) === "42501" &&
      (await errorCode("update public.consents set withdrawn_at = now()")) === "42501" &&
      (await errorCode("delete from public.consents")) === "42501",
  );
  check(
    "profiles.is_suspended can't be updated (42501)",
    (await errorCode("update public.profiles set is_suspended = true where id = $1", [alice])) ===
      "42501",
  );
  check(
    "nor can she suspend someone else (42501)",
    (await errorCode("update public.profiles set is_suspended = false where id = $1", [bob])) ===
      "42501",
  );

  // CHECKs.
  const replaceArea = async (kind, latitude, longitude) => {
    await client.query("delete from public.donor_areas where user_id = $1 and kind = $2", [
      alice,
      kind,
    ]);
    return errorCode(AREA_INSERT, [alice, kind, latitude, longitude]);
  };
  check("a latitude below 6 is refused (23514)", (await replaceArea("work", 5.5, 77)) === "23514");
  check(
    "a latitude above 37.5 is refused (23514)",
    (await replaceArea("work", 37.6, 77)) === "23514",
  );
  check(
    "a longitude below 68 is refused (23514)",
    (await replaceArea("work", 20, 67.9)) === "23514",
  );
  check(
    "a longitude above 98 is refused (23514)",
    (await replaceArea("work", 20, 98.5)) === "23514",
  );
  check("the corner of India's box is accepted", (await replaceArea("work", 37.5, 98)) === null);
  check(
    "a third kind of area is refused (23514)",
    (await replaceArea("school", 20, 77)) === "23514",
  );
  check(
    "a second home is refused (23505)",
    (await errorCode(AREA_INSERT, [alice, "home", 20, 77])) === "23505",
  );
  await client.query("delete from public.donor_settings where user_id = $1", [alice]);
  check(
    "max_requests_per_week of 8 is refused (23514)",
    (await errorCode(SETTINGS_INSERT, [alice, 8, "{in_app}"])) === "23514",
  );
  check("of 0 too (23514)", (await errorCode(SETTINGS_INSERT, [alice, 0, "{in_app}"])) === "23514");
  check(
    "an unknown channel is refused (23514)",
    (await errorCode(SETTINGS_INSERT, [alice, 2, "{in_app,whatsapp}"])) === "23514",
  );
  check(
    "an empty channel list is refused (23514)",
    (await errorCode(SETTINGS_INSERT, [alice, 2, "{}"])) === "23514",
  );
  check(
    "defaults apply for the rest",
    (await errorCode("insert into public.donor_settings (user_id) values ($1)", [alice])) ===
      null &&
      (
        await one(
          `select is_available, quiet_start::text as quiet_start, quiet_end::text as quiet_end,
                  max_requests_per_week, channels::text as channels
           from public.donor_settings where user_id = $1`,
          [alice],
        )
      ).channels === "{in_app,push}",
  );
  // The Data API's upsert sets every column it sends, the key columns included.
  check(
    "a settings upsert, as the Data API sends it, is accepted",
    (await errorCode(
      `insert into public.donor_settings (user_id, max_requests_per_week, channels)
       values ($1, 3, '{in_app}')
       on conflict (user_id) do update
       set user_id = excluded.user_id, max_requests_per_week = excluded.max_requests_per_week,
           channels = excluded.channels`,
      [alice],
    )) === null,
  );
  check(
    "an area upsert, as the Data API sends it, is accepted",
    (await errorCode(
      `insert into public.donor_areas (user_id, kind, latitude, longitude)
       values ($1, 'home', 19.08, 72.88)
       on conflict (user_id, kind) do update
       set user_id = excluded.user_id, kind = excluded.kind,
           latitude = excluded.latitude, longitude = excluded.longitude`,
      [alice],
    )) === null,
  );

  // ── donations, suspension and the status triggers ──
  await asPostgres();
  const tomorrow = (await one("select ((now() at time zone 'Asia/Kolkata')::date + 1)::text as d"))
    .d;
  check(
    "a donation dated in the future (India's date) is refused (23514)",
    (await errorCode(
      "insert into public.donations (donor_id, donated_on, kind) values ($1, $2, 'whole_blood')",
      [alice, tomorrow],
    )) === "23514",
  );
  const indiaToday = (await one("select (now() at time zone 'Asia/Kolkata')::date::text as d")).d;
  check(
    "one dated today is accepted",
    (await errorCode(
      "insert into public.donations (donor_id, donated_on, kind) values ($1, $2, 'apheresis_platelets')",
      [alice, indiaToday],
    )) === null,
  );
  check(
    "a kind outside the list is refused (23514)",
    (await errorCode(
      "insert into public.donations (donor_id, donated_on, kind) values ($1, $2, 'plasma')",
      [alice, indiaToday],
    )) === "23514",
  );
  const afterDonation = await statusOf(alice);
  const expectedFrom = (await one("select ($1::date + 90)::text as d", [indiaToday])).d;
  check(
    "a donation moves eligible_from on (male, 90 days)",
    afterDonation.eligible_from === expectedFrom,
    `${afterDonation.eligible_from} vs ${expectedFrom}`,
  );
  await asUser(alice);
  check(
    "alice reads her donation",
    (await count("select count(*) as n from public.donations")) === 1,
  );
  await asUser(bob);
  check("bob doesn't see it", (await count("select count(*) as n from public.donations")) === 0);
  await asUser(admin);
  check(
    "an admin can read donations",
    (await count("select count(*) as n from public.donations where donor_id = $1", [alice])) === 1,
  );

  await asPostgres();
  await client.query("update public.profiles set is_suspended = true where id = $1", [alice]);
  check("a suspended donor is out of the network", (await statusOf(alice)).is_in_network === false);
  await client.query("update public.profiles set is_suspended = false where id = $1", [alice]);
  check("and back in when the suspension ends", (await statusOf(alice)).is_in_network === true);
  await client.query("update public.profiles set is_donor = false where id = $1", [alice]);
  const notDonor = await statusOf(alice);
  check(
    "leaving the donor register ends the window and the membership",
    notDonor.is_in_network === false && notDonor.eligible_from === null,
  );
  await client.query("update public.profiles set is_donor = true where id = $1", [alice]);
  await client.query(
    `insert into public.donor_screening (user_id, on_medication) values ($1, true)
     on conflict (user_id) do update set on_medication = true`,
    [alice],
  );
  const medicated = await statusOf(alice);
  check(
    "medication sets needs_staff_check and the screening time",
    medicated.needs_staff_check === true && medicated.screening_confirmed_at !== null,
  );
  await client.query("update public.donor_status set asks_total = 4 where user_id = $1", [alice]);
  await client.query("update public.profiles set full_name = 'Renamed' where id = $1", [alice]);
  check(
    "a refresh keeps the counters",
    (await count("select asks_total as n from public.donor_status where user_id = $1", [alice])) ===
      4,
  );

  // ── withdrawing ──
  await asUser(alice);
  await client.query("select public.withdraw_consent('donor_network')");
  await asPostgres();
  check(
    "withdrawing deletes the areas and settings",
    (await count("select count(*) as n from public.donor_areas where user_id = $1", [alice])) ===
      0 &&
      (await count("select count(*) as n from public.donor_settings where user_id = $1", [
        alice,
      ])) === 0,
  );
  check(
    "closes the consent and leaves the network",
    (await openConsent(alice)) === 0 && (await statusOf(alice)).is_in_network === false,
  );
  await asUser(alice);
  check(
    "withdrawing again is a no-op",
    (await errorCode("select public.withdraw_consent('donor_network')")) === null,
  );
  check(
    "settings are refused again (42501)",
    (await errorCode(SETTINGS_INSERT, [alice, 2, "{in_app}"])) === "42501",
  );
  await asUser(bob);
  await client.query("select public.withdraw_consent('sms')");
  await asPostgres();
  check(
    "withdrawing sms leaves bob's areas and network membership alone",
    (await openConsent(bob, "sms")) === 0 &&
      (await openConsent(bob)) === 1 &&
      (await count("select count(*) as n from public.donor_areas where user_id = $1", [bob])) === 1,
  );

  // ── donor_cell_counts() ──
  const makeNetworkDonor = async (latitude, longitude, { tattoo = false } = {}) => {
    const id = await makeUser({ dob: "1990-03-03" });
    await client.query(
      "insert into public.consents (user_id, purpose, notice_version) values ($1, 'donor_network', $2)",
      [id, NOTICE],
    );
    await client.query(
      "insert into public.donor_areas (user_id, kind, latitude, longitude) values ($1, 'home', $2, $3)",
      [id, latitude, longitude],
    );
    if (tattoo) {
      await client.query(
        "insert into public.donor_screening (user_id, recent_tattoo) values ($1, true)",
        [id],
      );
    }
    return id;
  };
  // Two throwaway cells, far from anywhere real: 4 donors in one, 5 in the other (one of them
  // with a recent tattoo, so not eligible today).
  for (let index = 0; index < 4; index += 1) await makeNetworkDonor(7.01, 70.01);
  for (let index = 0; index < 5; index += 1) {
    await makeNetworkDonor(7.02, 70.02, { tattoo: index === 0 });
  }
  await asUser(alice);
  check(
    "donor_cell_counts() is refused for a non-admin (42501)",
    (await errorCode("select * from public.donor_cell_counts()")) === "42501",
  );
  await asAnon();
  check(
    "and for anon (42501)",
    (await errorCode("select * from public.donor_cell_counts()")) === "42501",
  );
  await asUser(admin);
  const { rows: cells } = await client.query(
    "select latitude::text as latitude, longitude::text as longitude, donors, eligible_today from public.donor_cell_counts()",
  );
  check(
    "an admin doesn't see a cell with 4 donors",
    !cells.some((cell) => cell.latitude === "7.01"),
  );
  const fiveCell = cells.find((cell) => cell.latitude === "7.02" && cell.longitude === "70.02");
  check(
    "but sees one with 5, counting those eligible today",
    fiveCell?.donors === 5 && fiveCell?.eligible_today === 4,
    JSON.stringify(fiveCell),
  );
  check(
    "no cell is shown with fewer than 5 donors",
    cells.every((cell) => cell.donors >= 5),
  );

  // ── parity with src/lib/eligibility.js ──
  await asPostgres();
  let fixture = null;
  try {
    fixture = JSON.parse(fs.readFileSync(FIXTURE_FILE, "utf8"));
  } catch (error) {
    check(`the parity fixture ${FIXTURE_FILE} can be read`, false, error.message);
  }
  if (fixture) {
    check(
      "the parity fixture has cases",
      Array.isArray(fixture.cases) && fixture.cases.length > 0,
      `${fixture.cases?.length ?? 0} cases`,
    );
    // Every row goes in through the normal triggers, so the window checked is the one they write.
    for (const testCase of fixture.cases ?? []) {
      await client.query("savepoint parity");
      try {
        const { details, donations = [], expected } = testCase;
        const id = await makeUser({ complete: false, donor: Boolean(details.isDonor) });
        await client.query(
          `update public.profiles set full_name = 'Parity Donor', dob = $2, gender = $3,
             phone = '+911234567890', state_code = '27', blood_group_code = '15'
           where id = $1`,
          [id, details.dob || null, details.gender || null],
        );
        const screening = details.donorDetails;
        if (screening) {
          await client.query(
            `insert into public.donor_screening (user_id, last_donation_date, recent_tattoo,
               pregnant, underweight, on_medication, has_disease)
             values ($1, $2, $3, $4, $5, $6, $7)`,
            [
              id,
              screening.lastDonationDate ?? null,
              Boolean(screening.recentTattoo),
              Boolean(screening.pregnant),
              Boolean(screening.underweight),
              Boolean(screening.onMedication),
              Boolean(screening.hasDisease),
            ],
          );
        }
        for (const donatedOn of donations) {
          await client.query(
            "insert into public.donations (donor_id, donated_on, kind) values ($1, $2, 'whole_blood')",
            [id, donatedOn],
          );
        }
        const status = await statusOf(id);
        const isMatch =
          status.eligible_from === expected.eligibleFrom &&
          status.eligible_until === expected.eligibleUntil &&
          status.needs_staff_check === expected.needsStaffCheck;
        check(
          `parity: ${testCase.name}`,
          isMatch,
          isMatch
            ? ""
            : `db ${status.eligible_from} to ${status.eligible_until}, staff check ${status.needs_staff_check}; ` +
                `expected ${expected.eligibleFrom} to ${expected.eligibleUntil}, ${expected.needsStaffCheck}`,
        );
      } catch (error) {
        check(`parity: ${testCase.name}`, false, error.message);
      }
      await client.query("rollback to savepoint parity");
    }
  }

  // ── delete_my_account() ──
  const leaver = await makeUser();
  await client.query(
    "insert into public.consents (user_id, purpose, notice_version) values ($1, 'donor_network', $2)",
    [leaver, NOTICE],
  );
  await client.query(
    "insert into public.consents (user_id, purpose, notice_version) values ($1, 'sms', $2)",
    [leaver, NOTICE],
  );
  await client.query("insert into public.donor_settings (user_id) values ($1)", [leaver]);
  await client.query(
    "insert into public.donor_areas (user_id, kind, latitude, longitude) values ($1, 'home', 12.97, 77.59)",
    [leaver],
  );
  await client.query(
    "insert into public.donor_screening (user_id, last_donation_date) values ($1, '2026-01-01')",
    [leaver],
  );
  await client.query(
    "insert into public.donations (donor_id, donated_on, kind) values ($1, '2026-02-01', 'whole_blood')",
    [leaver],
  );
  check("the leaver has a status row first", (await statusOf(leaver)) !== undefined);
  await asUser(leaver);
  check(
    "delete_my_account() works for a donor with rows in every new table",
    (await errorCode("select public.delete_my_account()")) === null,
  );
  await asPostgres();
  const left = await count(
    `select (select count(*) from public.profiles where id = $1)
          + (select count(*) from public.consents where user_id = $1)
          + (select count(*) from public.donor_settings where user_id = $1)
          + (select count(*) from public.donor_areas where user_id = $1)
          + (select count(*) from public.donations where donor_id = $1)
          + (select count(*) from public.donor_status where user_id = $1)
          + (select count(*) from public.donor_screening where user_id = $1) as n`,
    [leaver],
  );
  check("and nothing of theirs is left", left === 0, `${left} rows`);
} catch (error) {
  check("the checks ran to the end", false, error.message);
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
console.log(
  failures === 0
    ? `All ${total} checks passed; everything was rolled back.`
    : `${failures} of ${total} check(s) failed; everything was rolled back.`,
);
process.exitCode = failures === 0 ? 0 : 1;
