// Checks the donor network's schema (supabase/migrations/*_donor_network.sql,
// docs/PLANS/plan_donor_network.md, "Data model" and "Eligibility inside the database") on the
// project in SUPABASE_DB_URL, inside one transaction that is always rolled back, so nothing is
// kept: tables, grants and row-level security as a signed-in donor, the consent functions, the
// status triggers, donor_cell_counts() and delete_my_account(); and, from
// supabase/migrations/*_donor_requests.sql, blood_compatibility against src/lib/compatibility.js
// and create_request(), match_wave(), advance_requests(), request_wave_summary(),
// cancel_request() and the cron helpers, run as throwaway organization members and donors
// plus match_wave() against planWave(), the advisory lock and the request statuses. Throwaway users are inserted
// into auth.users inside the transaction; the rollback removes them. Applies the migration
// first if the project doesn't have them yet. Every case in tests/fixtures/eligibility_parity.json
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
const migrationFiles = ["_donor_network.sql", "_donor_requests.sql"].map((suffix) =>
  fs.readdirSync(path.join("supabase", "migrations")).find((fileName) => fileName.endsWith(suffix)),
);
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
  for (const migrationFile of migrationFiles) {
    const version = migrationFile.split("_")[0];
    const { rows: applied } = await client.query(
      "select 1 from supabase_migrations.schema_migrations where version = $1",
      [version],
    );
    if (applied.length === 0) {
      await client.query(
        fs.readFileSync(path.join("supabase", "migrations", migrationFile), "utf8"),
      );
      console.log(`${migrationFile}: applied inside the transaction`);
    } else {
      console.log(`${migrationFile}: already applied; checking the live objects`);
    }
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

  // ── blood_compatibility against src/lib/compatibility.js (P2.2) ──
  await asPostgres();
  await import("./register-src.mjs");
  const { componentCategory, donorGroupsFor } = await import("../src/lib/compatibility.js");
  const { BLOOD_GROUPS, COMPONENTS } = await import("../src/lib/constants.js");
  const compatibilityRows = (
    await client.query(
      "select recipient_code, component_category, donor_code from public.blood_compatibility",
    )
  ).rows;
  const tableSets = new Map();
  for (const row of compatibilityRows) {
    const key = `${row.recipient_code}|${row.component_category}`;
    if (!tableSets.has(key)) tableSets.set(key, new Set());
    tableSets.get(key).add(row.donor_code);
  }
  // Every component code is tried, so each code of a category is held to the same rows.
  let compatibilityMismatches = 0;
  let expectedRows = 0;
  const seenPairs = new Set();
  for (const recipient of BLOOD_GROUPS) {
    for (const component of COMPONENTS) {
      const category = componentCategory(component.code);
      if (!category) continue;
      const expected = new Set(donorGroupsFor(recipient.code, component.code).map((g) => g.code));
      const pair = `${recipient.code}|${category}`;
      const actual = tableSets.get(pair) ?? new Set();
      if (expected.size !== actual.size || [...expected].some((code) => !actual.has(code))) {
        compatibilityMismatches += 1;
        console.log(`  mismatch: recipient ${recipient.code}, ${category} (${component.code})`);
      }
      if (!seenPairs.has(pair)) {
        seenPairs.add(pair);
        expectedRows += expected.size;
      }
    }
  }
  check(
    "every blood_compatibility row set equals donorGroupsFor() for every group and component",
    compatibilityMismatches === 0,
    `${seenPairs.size} recipient/category pairs`,
  );
  check(
    "and the table holds no other row",
    compatibilityRows.length === expectedRows,
    `${compatibilityRows.length} rows, expected ${expectedRows}`,
  );
  let categoryMismatches = 0;
  for (const component of COMPONENTS) {
    const inDatabase = (await one("select public.component_category($1) as c", [component.code])).c;
    if (inDatabase !== (componentCategory(component.code) ?? null)) categoryMismatches += 1;
  }
  check(
    "component_category() equals componentCategory() for every component code",
    categoryMismatches === 0,
    `${COMPONENTS.length} codes`,
  );
  check(
    "and is null for an unknown code",
    (await one("select public.component_category('999') as c")).c === null,
  );
  check(
    "the tie-break key of S10 is never negative",
    (await count(
      `select count(*) as n from generate_series(1, 2000) g
       where ('x' || substr(md5(g::text), 1, 8))::bit(32)::bigint < 0`,
    )) === 0,
  );

  // ── requests in shadow mode: create_request(), match_wave(), advance_requests() ──
  const BANK = "9999990001";
  const NO_POSITION_BANK = "9999990002";
  const makeOrganization = async (kind, applicant) => {
    const { id } = await one(
      `insert into public.organizations
         (kind, name, registration_number, state_code, address, phone, status, applicant_id)
       values ($1, 'Check Org', 'REG-12345', '32', '1 Check Road, Nowhere', '+911234567890',
               'approved', $2)
       returning id`,
      [kind, applicant],
    );
    await client.query("update public.profiles set organization_id = $2 where id = $1", [
      applicant,
      id,
    ]);
    return id;
  };
  const bankMember = await makeUser({ donor: false });
  const hospitalMember = await makeUser({ donor: false });
  const outsider = await makeUser({ donor: false });
  const suspendedMember = await makeUser({ donor: false });
  const bankOrg = await makeOrganization("blood_bank", bankMember);
  await makeOrganization("hospital", hospitalMember);
  await client.query(
    "update public.profiles set organization_id = $2, is_suspended = true where id = $1",
    [suspendedMember, bankOrg],
  );
  // One bank with a usable position and one without, out at sea so no real donor is near.
  await client.query(
    `insert into public.blood_banks (hospital_code, name, latitude, longitude, location_quality)
     values ($1, 'Check Bank', 8.5, 71.0, 'ok'),
            ($2, 'Check Bank Without Position', null, null, 'missing')`,
    [BANK, NO_POSITION_BANK],
  );
  // A donor who passes every hard filter for group 15 near the bank; quiet hours are switched
  // off so the time of day doesn't matter.
  const makeRequestDonor = async (latitude, longitude) => {
    const id = await makeUser({ dob: "1990-03-03" });
    await client.query(
      "insert into public.consents (user_id, purpose, notice_version) values ($1, 'donor_network', $2)",
      [id, NOTICE],
    );
    await client.query(
      "insert into public.donor_areas (user_id, kind, latitude, longitude) values ($1, 'home', $2, $3)",
      [id, latitude, longitude],
    );
    await client.query(
      "insert into public.donor_settings (user_id, quiet_start, quiet_end) values ($1, '00:00', '00:00')",
      [id],
    );
    await client.query("insert into public.donor_screening (user_id) values ($1)", [id]);
    return id;
  };
  const nearDonors = [];
  for (let index = 0; index < 6; index += 1) {
    nearDonors.push(await makeRequestDonor(8.51, 71.01));
  }
  const farDonor = await makeRequestDonor(8.8, 71.0); // about 33 km from the bank
  check(
    "the request donors are all in the network",
    (await count(
      "select count(*) as n from public.donor_status where user_id = any($1) and is_in_network",
      [[...nearDonors, farDonor]],
    )) === 7,
  );

  const CREATE_SQL = "select public.create_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as id";
  const requestArgs = (changes = {}) => {
    const o = {
      bank: BANK,
      group: "15",
      component: "11",
      units: 2,
      urgency: "critical",
      neededBy: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
      compatible: false,
      reference: null,
      kind: "shortfall",
      freeFlow: 30,
      congestion: 50,
      rain: 1,
      ...changes,
    };
    return [
      o.bank,
      o.group,
      o.component,
      o.units,
      o.urgency,
      o.neededBy,
      o.compatible,
      o.reference,
      o.kind,
      o.freeFlow,
      o.congestion,
      o.rain,
    ];
  };
  const requestRow = (id) =>
    one(
      `select status, waves_sent, units_donated, area, closed_at, close_reason,
              extract(epoch from next_wave_at - now())::float8 as wait_s
       from public.blood_requests where id = $1`,
      [id],
    );
  const raiseAs = async (userId, changes) => {
    await asUser(userId);
    const { id } = await one(CREATE_SQL, requestArgs(changes));
    await asPostgres();
    return id;
  };
  const counters = async () =>
    JSON.stringify(
      await one(
        `select sum(asks_total) as asks, sum(accepts_total) as accepts, sum(shows_total) as shows,
                sum(ignored_in_a_row) as ignored, count(last_asked_at) as asked_at
         from public.donor_status where user_id = any($1)`,
        [[...nearDonors, farDonor]],
      ),
    );
  const waveOf = (requestId, wave) =>
    one("select * from public.request_waves where request_id = $1 and wave = $2", [
      requestId,
      wave,
    ]);
  const wavesOf = (requestId) =>
    count("select count(*) as n from public.request_waves where request_id = $1", [requestId]);

  // Refusals.
  for (const [label, userId] of [
    ["a donor", nearDonors[0]],
    ["a signed-in user outside any organization", outsider],
    ["a suspended member", suspendedMember],
  ]) {
    await asUser(userId);
    check(
      `create_request() is refused for ${label} (42501)`,
      (await errorCode(CREATE_SQL, requestArgs())) === "42501",
    );
  }
  await asSignedOut();
  check("and when signed out (42501)", (await errorCode(CREATE_SQL, requestArgs())) === "42501");
  await asAnon();
  check("and for anon (42501)", (await errorCode(CREATE_SQL, requestArgs())) === "42501");
  await asUser(bankMember);
  const badInputs = {
    "units of 0": { units: 0 },
    "units of 51": { units: 51 },
    "an unknown urgency": { urgency: "now" },
    "an unknown kind": { kind: "other" },
    "an unknown blood group": { group: "99" },
    "an unknown component": { component: "99" },
    "a needed-by under 30 minutes away": {
      neededBy: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    },
    "a needed-by over 14 days away": {
      neededBy: new Date(Date.now() + 15 * 86400 * 1000).toISOString(),
    },
    "a free-flow speed of 4": { freeFlow: 4 },
    "a free-flow speed of 121": { freeFlow: 121 },
    "a congestion of 201": { congestion: 201 },
    "a rain factor of 1.31": { rain: 1.31 },
    "a rain factor of 0.9": { rain: 0.9 },
    "a 41 character patient reference": { reference: "x".repeat(41) },
    "an anchor without a usable position": { bank: NO_POSITION_BANK },
  };
  for (const [label, changes] of Object.entries(badInputs)) {
    check(
      `create_request() refuses ${label} (22023)`,
      (await errorCode(CREATE_SQL, requestArgs(changes))) === "22023",
    );
  }
  check(
    "and an unknown anchor code (P0002)",
    (await errorCode(CREATE_SQL, requestArgs({ bank: "9999999999" }))) === "P0002",
  );
  await asUser(hospitalMember);
  check(
    "a hospital can't accept compatible groups (42501)",
    (await errorCode(CREATE_SQL, requestArgs({ compatible: true }))) === "42501",
  );
  await asPostgres();
  check(
    "none of the refusals left a request behind",
    (await count("select count(*) as n from public.blood_requests")) === 0,
  );

  // ── the advisory lock ──
  // match_wave(), create_request(), cancel_request() and advance_requests() take
  // pg_advisory_xact_lock(hashtext('bloodlink.match_wave')) so waves never run side by side. A
  // second connection only ever probes the lock, never calls the functions. Each function runs
  // inside a savepoint here, and rolling the savepoint back lets the lock go; the main
  // transaction takes the lock for good with its first successful call below, so this section
  // has to come first.
  const LOCK_KEY = "hashtext('bloodlink.match_wave')";
  const probe = new pg.Client({
    connectionString: databaseUrl,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
  await probe.connect();
  try {
    const lockFree = async () => {
      await probe.query("begin");
      const { rows } = await probe.query(`select pg_try_advisory_xact_lock(${LOCK_KEY}) as got`);
      await probe.query("rollback");
      return rows[0].got;
    };
    const lockers = (
      await client.query(
        `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and proname in ('match_wave', 'create_request', 'cancel_request', 'advance_requests')
           and prosrc like '%pg_advisory_xact_lock(hashtext(''bloodlink.match_wave''))%'`,
      )
    ).rows.length;
    check("all four request functions name the lock in their source", lockers === 4, `${lockers}`);
    check("the lock is free before any of them runs", (await lockFree()) === true);

    const dummyRequest = async () =>
      (
        await one(
          `insert into public.blood_requests
             (kind, organization_id, anchor_hospital_code, anchor_point, blood_group_code,
              component_id, units_needed, urgency, needed_by, zone_free_flow_kmh,
              congestion_percent, rain_factor, area)
           values ('shortfall', $1, $2,
                   extensions.st_setsrid(extensions.st_makepoint(71.0, 8.5), 4326)::extensions.geography,
                   '15', '11', 1, 'routine', now() + interval '1 day', 30, 0, 1, 'rural')
           returning id`,
          [bankOrg, BANK],
        )
      ).id;
    const lockHolders = {
      "create_request()": async () => {
        await asUser(bankMember);
        await client.query(CREATE_SQL, requestArgs());
        await asPostgres();
      },
      "advance_requests()": async () => {
        await client.query("select public.advance_requests()");
      },
      "match_wave()": async () => {
        await client.query("select public.match_wave($1)", [await dummyRequest()]);
      },
      "cancel_request()": async () => {
        const id = await dummyRequest();
        await asUser(bankMember);
        await client.query("select public.cancel_request($1, 'lock check')", [id]);
        await asPostgres();
      },
    };
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (const [name, hold] of Object.entries(lockHolders)) {
      await client.query("savepoint lock_check");
      await hold();
      const freeWhileHeld = await lockFree();
      // A blocking request for the lock waits and gives up at its lock_timeout.
      await probe.query("begin");
      await probe.query("set local lock_timeout = '300ms'");
      const blockedCode = await probe.query(`select pg_advisory_xact_lock(${LOCK_KEY})`).then(
        () => null,
        (error) => error.code,
      );
      await probe.query("rollback");
      await asPostgres();
      await client.query("rollback to savepoint lock_check");
      await client.query("release savepoint lock_check");
      check(
        `${name} holds the lock until its transaction ends: a second connection can't take it`,
        freeWhileHeld === false,
      );
      check(`and a blocking request for it times out (55P03)`, blockedCode === "55P03");
      check(`and it is free again once the savepoint is rolled back`, (await lockFree()) === true);
    }

    // A second connection waiting on the lock gets it the moment the first lets go.
    await client.query("savepoint lock_check");
    await lockHolders["advance_requests()"]();
    await probe.query("begin");
    let granted = false;
    const waiting = probe.query(`select pg_advisory_xact_lock(${LOCK_KEY})`).then(() => {
      granted = true;
    });
    await sleep(400);
    const grantedWhileHeld = granted;
    const waiters = await count(
      "select count(*) as n from pg_locks where locktype = 'advisory' and not granted",
    );
    await client.query("rollback to savepoint lock_check");
    await client.query("release savepoint lock_check");
    await waiting;
    await probe.query("rollback");
    check(
      "a waiting connection is queued behind the first and not granted while it holds the lock",
      grantedWhileHeld === false && waiters === 1,
      `${waiters} waiting`,
    );
    check("and is granted it once the first lets go", granted === true);
    check("nothing is left holding the lock", (await lockFree()) === true);
  } finally {
    await probe.query("rollback").catch(() => {});
    await probe.end();
  }

  // A critical request runs its first wave at once. Group 15 donors within 20 km (rural): the
  // six near ones. Wanted: ceil(2 x 1.5) = 3; p_accept 1/5; k = min(ceil(3 / 0.2), cap 40, 6).
  const countersBefore = await counters();
  const r1 = await raiseAs(bankMember, { reference: "  CHK-1  " });
  const r1Row = await requestRow(r1);
  check(
    "a critical request is open and rural, with wave 1 sent and the next in 10 minutes",
    r1Row.status === "open" &&
      r1Row.area === "rural" &&
      r1Row.waves_sent === 1 &&
      r1Row.wait_s > 500 &&
      r1Row.wait_s <= 600,
    JSON.stringify(r1Row),
  );
  check(
    "the patient reference is trimmed",
    (await one("select patient_reference as p from public.blood_requests where id = $1", [r1]))
      .p === "CHK-1",
  );
  const wave1 = await waveOf(r1, 1);
  check(
    "wave 1 is recorded: ring 20 km, 6 candidates, 6 asked, all exact",
    wave1?.ring_km === 20 &&
      wave1.candidate_count === 6 &&
      wave1.k === 6 &&
      wave1.exact_count === 6 &&
      wave1.compatible_count === 0 &&
      Math.abs(wave1.p_accept - 0.2) < 1e-9,
    JSON.stringify(wave1),
  );
  check(
    "its filters show the far donor outside the ring and nobody else removed",
    wave1?.filter_counts.outside_ring === 1 &&
      wave1.filter_counts.already_asked === 0 &&
      wave1.filter_counts.group === 0 &&
      wave1.distance_bands[0] === 6,
    JSON.stringify(wave1?.filter_counts),
  );
  const asked1 = (
    await client.query(
      "select donor_id, status, wave, score, est_minutes from public.request_responses where request_id = $1",
      [r1],
    )
  ).rows;
  check(
    "six donors were asked, each once, and every response is still 'notified'",
    asked1.length === 6 &&
      asked1.every((row) => row.status === "notified" && row.wave === 1) &&
      asked1.every((row) => nearDonors.includes(row.donor_id)),
  );
  check(
    "scores are in (0, 1] and the wave's score range matches them",
    asked1.every((row) => row.score > 0 && row.score <= 1) &&
      Math.abs(wave1.score_max - Math.max(...asked1.map((row) => row.score))) < 1e-12 &&
      Math.abs(wave1.score_min - Math.min(...asked1.map((row) => row.score))) < 1e-12,
  );
  const minutes = await one(
    `select st_distance(a.cell, r.anchor_point) / 1000 * 1.34 / 30 * 60 * 1.5 as m
     from public.donor_areas a, public.blood_requests r
     where a.user_id = $1 and r.id = $2`,
    [asked1[0].donor_id, r1],
  );
  check(
    "est_minutes is km x 1.34 / free-flow x 60 x (1 + congestion) x rain",
    Math.abs(asked1[0].est_minutes - minutes.m) < 1e-9,
    `${asked1[0].est_minutes} vs ${minutes.m}`,
  );
  check(
    "a shadow ask leaves donor_status alone (asks, accepts, shows, ignored, last asked)",
    (await counters()) === countersBefore,
    await counters(),
  );

  // Wave 2 (ring 50 km): the far donor, the only one left.
  await client.query(
    "update public.blood_requests set next_wave_at = now() - interval '1 minute' where id = $1",
    [r1],
  );
  const askedByRun = (await one("select public.advance_requests() as n")).n;
  const wave2 = await waveOf(r1, 2);
  check(
    "advance_requests() sends wave 2 on a ring of 50 km to the one donor left",
    askedByRun === 1 && wave2?.ring_km === 50 && wave2.candidate_count === 1 && wave2.k === 1,
    JSON.stringify(wave2),
  );
  const r1Mid = await requestRow(r1);
  check(
    "the request stays open with 2 waves sent",
    r1Mid.status === "open" && r1Mid.waves_sent === 2,
  );
  check(
    "a request that is not due is left alone",
    (await one("select public.advance_requests() as n")).n === 0 && (await wavesOf(r1)) === 2,
  );

  // Who may run the internal functions.
  for (const [label, becomeRole] of [
    ["authenticated", () => asUser(bankMember)],
    ["anon", asAnon],
  ]) {
    await becomeRole();
    check(
      `match_wave() is refused for ${label} (42501)`,
      (await errorCode("select public.match_wave($1)", [r1])) === "42501",
    );
    check(
      "and advance_requests() (42501)",
      (await errorCode("select public.advance_requests()")) === "42501",
    );
  }

  // The summary.
  await asUser(bankMember);
  const summary = (await client.query("select * from public.request_wave_summary($1)", [r1])).rows;
  const summaryColumns = [
    "wave",
    "ring_km",
    "candidate_count",
    "k",
    "p_accept",
    "exact_count",
    "compatible_count",
    "distance_bands",
    "score_min",
    "score_median",
    "score_max",
    "filter_counts",
    "ran_at",
  ];
  check(
    "request_wave_summary() gives a member the waves in order, with the agreed columns",
    summary.length === 2 &&
      summary[0].wave === 1 &&
      summary[1].wave === 2 &&
      JSON.stringify(Object.keys(summary[0])) === JSON.stringify(summaryColumns),
    Object.keys(summary[0] ?? {}).join(","),
  );
  await asUser(admin);
  check(
    "and an admin the same",
    (await client.query("select * from public.request_wave_summary($1)", [r1])).rows.length === 2,
  );
  for (const [label, userId] of [
    ["another organization's member", hospitalMember],
    ["a signed-in user outside any organization", outsider],
    ["a donor", nearDonors[0]],
  ]) {
    await asUser(userId);
    check(
      `request_wave_summary() is refused for ${label} (42501)`,
      (await errorCode("select * from public.request_wave_summary($1)", [r1])) === "42501",
    );
  }
  await asUser(bankMember);
  check(
    "and an unknown request id gives P0002",
    (await errorCode("select * from public.request_wave_summary(-1)")) === "P0002",
  );

  // Row-level security and grants.
  await asUser(nearDonors[0]);
  check(
    "a donor, though asked, sees no request, wave or response",
    (await count("select count(*) as n from public.blood_requests")) === 0 &&
      (await count("select count(*) as n from public.request_waves")) === 0 &&
      (await count("select count(*) as n from public.request_responses")) === 0,
  );
  await asUser(bankMember);
  check(
    "a member sees their organization's request and waves, not the responses",
    (await count("select count(*) as n from public.blood_requests where id = $1", [r1])) === 1 &&
      (await count("select count(*) as n from public.request_waves where request_id = $1", [
        r1,
      ])) === 2 &&
      (await count("select count(*) as n from public.request_responses")) === 0,
  );
  await asUser(hospitalMember);
  check(
    "another organization's member sees neither",
    (await count("select count(*) as n from public.blood_requests where id = $1", [r1])) === 0 &&
      (await count("select count(*) as n from public.request_waves where request_id = $1", [
        r1,
      ])) === 0,
  );
  await asUser(admin);
  check(
    "an admin sees the request, its waves and its 7 responses",
    (await count("select count(*) as n from public.blood_requests where id = $1", [r1])) === 1 &&
      (await count("select count(*) as n from public.request_waves where request_id = $1", [
        r1,
      ])) === 2 &&
      (await count("select count(*) as n from public.request_responses where request_id = $1", [
        r1,
      ])) === 7,
  );
  await asUser(bankMember);
  check(
    "a member can't write the tables directly (42501)",
    (await errorCode("update public.blood_requests set units_needed = 9 where id = $1", [r1])) ===
      "42501" && (await errorCode("delete from public.request_responses")) === "42501",
  );
  check(
    "or read blood_compatibility (42501)",
    (await errorCode("select * from public.blood_compatibility")) === "42501",
  );
  await asAnon();
  check(
    "anon has no access to any request table (42501)",
    (await errorCode("select * from public.blood_requests")) === "42501" &&
      (await errorCode("select * from public.request_waves")) === "42501" &&
      (await errorCode("select * from public.request_responses")) === "42501",
  );
  await asPostgres();

  // Time passes: needed_by reached with nothing donated.
  await client.query(
    "update public.blood_requests set needed_by = now() - interval '1 minute' where id = $1",
    [r1],
  );
  await client.query("select public.advance_requests()");
  const r1End = await requestRow(r1);
  check(
    "at needed_by, with nothing donated, a request is expired and closed",
    r1End.status === "expired" &&
      r1End.closed_at !== null &&
      r1End.close_reason === "Needed-by time reached",
    JSON.stringify(r1End),
  );
  check(
    "no further wave runs for a closed request",
    (await one("select public.match_wave($1) as n", [r1])).n === 0 && (await wavesOf(r1)) === 2,
  );

  // Rule 9 and `rested` read the same-mode history in request_responses. Backdated by 80 hours
  // the asks pass the 72 hour gap, and the weekly limit (2) still has room.
  await client.query(
    "update public.request_responses set created_at = now() - interval '80 hours' where request_id = $1",
    [r1],
  );
  const r2 = await raiseAs(bankMember, { urgency: "urgent", units: 1 });
  const wave21 = await waveOf(r2, 1);
  check(
    "an urgent request asks the donors last asked over 72 hours ago",
    wave21?.candidate_count === 6 && wave21.k === 6 && wave21.filter_counts.asked_too_often === 0,
    JSON.stringify(wave21),
  );
  const row2 = await one(
    "select score, est_minutes from public.request_responses where request_id = $1 order by id limit 1",
    [r2],
  );
  // respond 1/5 x show 4/5 x exp(-minutes / 45) x rested (0.5 + 80 / 24 / 28) x exact 1
  const expectedScore = 0.2 * 0.8 * Math.exp(-row2.est_minutes / 45) * (0.5 + 80 / 24 / 28);
  check(
    "its score is respond x show x e^(-minutes/45) x rested, rested read from the earlier ask",
    Math.abs(row2.score - expectedScore) < 1e-6,
    `${row2.score} vs ${expectedScore}`,
  );
  check("the donors' counters are still untouched", (await counters()) === countersBefore);
  // Rule 9 now: a third request finds every near donor asked within the last 72 hours.
  const r3 = await raiseAs(bankMember, { urgency: "critical", units: 2 });
  const wave31 = await waveOf(r3, 1);
  check(
    "a request right after finds those donors filtered out: an empty wave",
    wave31?.candidate_count === 0 &&
      wave31.k === 0 &&
      wave31.filter_counts.asked_too_often >= 6 &&
      wave31.score_min === null,
    JSON.stringify(wave31),
  );
  check("an empty wave still counts as sent", (await requestRow(r3)).waves_sent === 1);

  // The end states: the last wave sent and its gap passed, and needed_by with a donation.
  await client.query(
    "update public.blood_requests set waves_sent = 4, next_wave_at = now() - interval '1 minute' where id = $1",
    [r2],
  );
  await client.query("select public.advance_requests()");
  const r2End = await requestRow(r2);
  check(
    "after the last wave and its gap, with nothing donated, a request expires",
    r2End.status === "expired" && r2End.close_reason === "All waves sent" && r2End.waves_sent === 4,
    JSON.stringify(r2End),
  );
  await client.query(
    "update public.blood_requests set units_donated = 1, needed_by = now() - interval '1 minute' where id = $1",
    [r3],
  );
  await client.query("select public.advance_requests()");
  check(
    "at needed_by with some units donated it is partly fulfilled",
    (await requestRow(r3)).status === "partly_fulfilled",
  );

  // A routine request waits for the 09:00 to 20:00 India window and runs no first wave.
  const r4 = await raiseAs(bankMember, { urgency: "routine", units: 1 });
  const r4Row = await requestRow(r4);
  const r4Time = await one(
    "select (next_wave_at at time zone 'Asia/Kolkata')::time::text as t from public.blood_requests where id = $1",
    [r4],
  );
  check(
    "a routine request runs no wave on creation; its first wave is in the 09:00 to 20:00 window",
    r4Row.waves_sent === 0 &&
      r4Time.t >= "09:00:00" &&
      r4Time.t < "20:00:00" &&
      (await wavesOf(r4)) === 0,
    r4Time.t,
  );
  await client.query(
    "update public.blood_requests set units_donated = units_needed, next_wave_at = now() - interval '1 minute' where id = $1",
    [r4],
  );
  await client.query("select public.advance_requests()");
  const r4End = await requestRow(r4);
  check(
    "a request with no units left is fulfilled and closed, with no wave run",
    r4End.status === "fulfilled" && r4End.closed_at !== null && (await wavesOf(r4)) === 0,
    JSON.stringify(r4End),
  );

  // Compatible groups: a blood bank may allow them.
  const r5 = await raiseAs(bankMember, { urgency: "routine", compatible: true });
  check(
    "a blood bank can raise a request that accepts compatible groups",
    (await one("select allow_compatible as a from public.blood_requests where id = $1", [r5])).a ===
      true,
  );

  // cancel_request().
  for (const [label, userId] of [
    ["another organization's member", hospitalMember],
    ["a donor", nearDonors[0]],
    ["a signed-in user outside any organization", outsider],
  ]) {
    await asUser(userId);
    check(
      `cancel_request() is refused for ${label} (42501)`,
      (await errorCode("select public.cancel_request($1, 'no longer needed')", [r5])) === "42501",
    );
  }
  await asAnon();
  check(
    "and for anon (42501)",
    (await errorCode("select public.cancel_request($1, 'x')", [r5])) === "42501",
  );
  await asUser(bankMember);
  check(
    "it refuses an empty reason and one over 200 characters (22023)",
    (await errorCode("select public.cancel_request($1, '   ')", [r5])) === "22023" &&
      (await errorCode("select public.cancel_request($1, $2)", [r5, "x".repeat(201)])) === "22023",
  );
  check(
    "and an unknown request (P0002)",
    (await errorCode("select public.cancel_request(-1, 'x')")) === "P0002",
  );
  check(
    "a member can cancel their organization's request",
    (await errorCode("select public.cancel_request($1, 'Patient discharged')", [r5])) === null,
  );
  await asPostgres();
  const r5End = await requestRow(r5);
  check(
    "which closes it as cancelled with the reason",
    r5End.status === "cancelled" &&
      r5End.closed_at !== null &&
      r5End.close_reason === "Patient discharged",
    JSON.stringify(r5End),
  );
  await asUser(bankMember);
  check(
    "a second cancel is refused (22023)",
    (await errorCode("select public.cancel_request($1, 'again')", [r5])) === "22023",
  );
  await asPostgres();

  // Open-request cap: 10 per organization.
  for (let index = 0; index < 10; index += 1) {
    await raiseAs(hospitalMember, { urgency: "routine" });
  }
  await asUser(hospitalMember);
  check(
    "an organization with 10 open requests can't raise an 11th (22023)",
    (await errorCode(CREATE_SQL, requestArgs({ urgency: "routine" }))) === "22023",
  );
  await asPostgres();

  // The cron job: created and removed here, inside the rolled-back transaction.
  await asUser(bankMember);
  check(
    "schedule_donor_requests() and unschedule_donor_requests() are refused for a signed-in user",
    (await errorCode("select public.schedule_donor_requests()")) === "42501" &&
      (await errorCode("select public.unschedule_donor_requests()")) === "42501",
  );
  await asPostgres();
  const wasScheduled = await count(
    "select count(*) as n from cron.job where jobname = 'advance-requests'",
  );
  check("the migration itself schedules nothing", wasScheduled === 0, `${wasScheduled} jobs`);
  const scheduled = (await one("select public.schedule_donor_requests() as j")).j;
  const job = await one(
    "select schedule, command from cron.job where jobname = 'advance-requests'",
  );
  check(
    "schedule_donor_requests() adds the one-minute advance_requests() job",
    scheduled["advance-requests"] !== undefined &&
      job?.schedule === "* * * * *" &&
      job.command.includes("public.advance_requests()"),
    JSON.stringify(job),
  );
  await client.query("select public.schedule_donor_requests()");
  check(
    "calling it again leaves one job",
    (await count("select count(*) as n from cron.job where jobname = 'advance-requests'")) === 1,
  );
  check(
    "unschedule_donor_requests() removes it and says how many",
    (await one("select public.unschedule_donor_requests() as n")).n === 1 &&
      (await count("select count(*) as n from cron.job where jobname = 'advance-requests'")) === 0,
  );

  // ── match_wave() against planWave() ──
  // About 200 throwaway donors around the bank, some failing each of the 12 hard filters, and a
  // table of requests run through match_wave(). Each result is compared with planWave() fed the
  // same inputs: the tie keys of S10 (md5 of request:donor, drawn in String(id).localeCompare
  // order) and the exact distances of S11. The requests and their responses are deleted after
  // each one so the donors' history stays as seeded.
  const {
    planWave,
    passesHardFilters,
    nextRequestStatus,
    waveTarget,
    WAVE_SETTINGS,
    seededRandom,
  } = await import("../src/lib/donorMatching.js");
  const { indiaDate } = await import("../src/lib/donorMatching.js");

  // The requests and donors made above take no part: close the open requests and take the
  // earlier donors off the map, so the pool near the bank is exactly the seeded one.
  const bystanders = [...nearDonors, farDonor];
  await client.query(
    `update public.blood_requests
     set status = 'cancelled', closed_at = now(), close_reason = 'check cleanup'
     where status in ('open', 'covered')`,
  );
  await client.query("delete from public.donor_areas where user_id = any($1)", [bystanders]);

  const MS_H = 3_600_000;
  const NOW = (await one("select now() as n")).n;
  const hoursAgo = (hours) => new Date(NOW.getTime() - hours * MS_H);
  const addDays = (date, days) =>
    new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const today = indiaDate(NOW);
  const istMinute = (NOW.getUTCHours() * 60 + NOW.getUTCMinutes() + 330) % 1440;
  const clock = (minute) => {
    const m = ((Math.round(minute) % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  };
  const ANCHOR_SQL =
    "extensions.st_setsrid(extensions.st_makepoint(71.0, 8.5), 4326)::extensions.geography";
  const pointAt = (km, bearing) => ({
    lat: Number((8.5 + (km * Math.cos(bearing)) / 111).toFixed(2)),
    lon: Number((71.0 + (km * Math.sin(bearing)) / 111).toFixed(2)),
  });
  const insertRequest = async (o) =>
    (
      await one(
        `insert into public.blood_requests
           (kind, organization_id, anchor_hospital_code, anchor_point, blood_group_code,
            component_id, units_needed, urgency, needed_by, allow_compatible,
            zone_free_flow_kmh, congestion_percent, rain_factor, area, status, waves_sent,
            next_wave_at, units_donated, created_by, closed_at, close_reason)
         values ($1, $2, $3, ${ANCHOR_SQL}, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                 $16, $17, $18, $19, $20)
         returning id`,
        [
          o.kind ?? "shortfall",
          bankOrg,
          BANK,
          o.group ?? "15",
          o.component ?? "11",
          o.units ?? 2,
          o.urgency ?? "critical",
          o.neededBy ?? new Date(NOW.getTime() + 6 * MS_H),
          o.compatible ?? false,
          o.freeFlow ?? 30,
          o.congestion ?? 50,
          o.rain ?? 1,
          o.area ?? "rural",
          o.status ?? "open",
          o.wavesSent ?? 0,
          o.nextWaveAt ?? NOW,
          o.donated ?? 0,
          o.createdBy ?? null,
          o.status && !["open", "covered"].includes(o.status) ? NOW : null,
          o.status && !["open", "covered"].includes(o.status) ? "check" : null,
        ],
      )
    ).id;
  const insertResponses = (rows) =>
    client.query(
      `insert into public.request_responses
         (request_id, donor_id, wave, score, est_minutes, is_exact_group, status, created_at)
       select r.request_id, r.donor_id, r.wave, 0, 0, true, r.status, r.created_at
       from jsonb_to_recordset($1::jsonb)
         as r(request_id bigint, donor_id uuid, wave int, status text, created_at timestamptz)`,
      [JSON.stringify(rows)],
    );

  // The donors. Deterministic: seededRandom with a fixed seed.
  const rng = seededRandom(20261117);
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const between = (low, high) => low + rng() * (high - low);
  const chance = (p) => rng() < p;
  const BANDS = [
    [0.5, 4],
    [5.5, 9],
    [10.5, 14],
    [16, 23],
    [27, 49],
    [52, 98],
    [102, 148],
    [153, 180],
  ];
  const GROUP_POOL = [
    "11",
    "11",
    "12",
    "13",
    "13",
    "14",
    "15",
    "15",
    "15",
    "16",
    "17",
    "18",
    "22",
    "23",
  ];
  const HISTORY_HOURS = [3, 20, 48, 70, 74, 100, 140, 165, 171, 200, 400];
  const NO_QUIET = { quietStart: "00:00", quietEnd: "00:00" };
  const specs = [];
  const newSpec = (o) => {
    const spec = {
      id: crypto.randomUUID(),
      group: "15",
      isInNetwork: true,
      eligibleFrom: addDays(today, -10),
      eligibleUntil: addDays(today, 200),
      needsStaffCheck: false,
      screeningConfirmedAt: hoursAgo(240),
      asks: 0,
      accepts: 0,
      shows: 0,
      settings: {
        isAvailable: true,
        snoozedUntil: null,
        ...NO_QUIET,
        criticalOverridesQuiet: false,
        criticalOverridesGap: false,
        maxRequestsPerWeek: 7,
        apheresisWilling: true,
      },
      areas: [],
      history: [],
      ...o,
    };
    specs.push(spec);
    return spec;
  };
  for (let index = 0; index < 150; index += 1) {
    const group = pick(GROUP_POOL);
    // Group 14 only lives beyond 26 km, so a 14 request in an urban ring finds nobody.
    const band = group === "14" ? pick(BANDS.slice(4)) : pick(BANDS);
    const areas = [{ kind: "home", ...pointAt(between(...band), rng() * 2 * Math.PI) }];
    if (chance(0.25)) {
      areas.push({ kind: "work", ...pointAt(between(...pick(BANDS)), rng() * 2 * Math.PI) });
    }
    const asks = Math.floor(rng() * 41);
    const accepts = Math.floor(rng() * (asks + 1));
    const shows = Math.floor(rng() * (accepts + 1));
    let eligibleFrom = addDays(today, -1 - Math.floor(rng() * 60));
    let eligibleUntil = addDays(today, 30 + Math.floor(rng() * 300));
    const window = rng();
    if (window < 0.07) eligibleFrom = addDays(today, 1);
    else if (window < 0.12) eligibleFrom = addDays(today, 5);
    else if (window < 0.17) {
      eligibleFrom = addDays(today, -100);
      eligibleUntil = addDays(today, -2);
    } else if (window < 0.19) {
      eligibleFrom = null;
      eligibleUntil = null;
    }
    const screening = rng();
    let screenedDays;
    if (screening < 0.06) screenedDays = null;
    else if (screening < 0.14) screenedDays = 91 + Math.floor(rng() * 60);
    else if (screening < 0.17) screenedDays = 90;
    else screenedDays = Math.floor(rng() * 85);
    let settings = null;
    if (!chance(0.05)) {
      const quiet = pick(["none", "active", "inactive", "default", "default"]);
      const quietWindow = {
        none: NO_QUIET,
        active: { quietStart: clock(istMinute - 120), quietEnd: clock(istMinute + 90) },
        inactive: { quietStart: clock(istMinute + 90), quietEnd: clock(istMinute + 240) },
        default: { quietStart: "22:00", quietEnd: "07:00" },
      }[quiet];
      const snooze = rng();
      settings = {
        isAvailable: chance(0.92),
        snoozedUntil: snooze < 0.08 ? hoursAgo(-5) : snooze < 0.15 ? hoursAgo(5) : null,
        ...quietWindow,
        criticalOverridesQuiet: chance(0.3),
        criticalOverridesGap: chance(0.3),
        maxRequestsPerWeek: pick([1, 2, 2, 2, 3, 5, 7]),
        apheresisWilling: chance(0.5),
      };
    }
    const history = [];
    for (let n = pick([0, 0, 0, 1, 1, 2, 3, 4]); n > 0; n -= 1) {
      const hours = pick(HISTORY_HOURS.filter((h) => !history.includes(h)));
      history.push(hours);
    }
    newSpec({
      group,
      isInNetwork: chance(0.93),
      eligibleFrom,
      eligibleUntil,
      needsStaffCheck: chance(0.06),
      screeningConfirmedAt:
        screenedDays === null ? null : new Date(hoursAgo(screenedDays * 24 + rng() * 5)),
      asks,
      accepts,
      shows,
      settings,
      areas,
      history,
    });
  }
  // A crowd of valid group 15 donors within 3 km (the cap), eight identical twins (only the tie
  // key tells them apart) and strong Bombay donors (the minimum).
  const crowd = [];
  for (let index = 0; index < 45; index += 1) {
    const asks = Math.floor(rng() * 21);
    crowd.push(
      newSpec({
        areas: [{ kind: "home", ...pointAt(between(0.5, 3), rng() * 2 * Math.PI) }],
        asks,
        accepts: Math.floor(rng() * (asks + 1)),
        shows: 0,
        history: index % 3 === 0 ? [100] : [],
      }),
    );
  }
  const twinPoint = pointAt(1.2, 1);
  for (let index = 0; index < 8; index += 1) {
    newSpec({ areas: [{ kind: "home", ...twinPoint }], asks: 10, accepts: 4, shows: 3 });
  }
  for (const group of ["22", "22", "22", "22", "22", "22", "23", "23", "23", "23"]) {
    newSpec({
      group,
      areas: [{ kind: "home", ...pointAt(between(0.5, 3), rng() * 2 * Math.PI) }],
      asks: 30,
      accepts: 30,
      shows: 30,
    });
  }

  const poolIds = specs.map((s) => s.id);
  await client.query(
    `insert into auth.users (id, email)
     select u, 'donor-network-check-pool-' || u || '@example.invalid' from unnest($1::uuid[]) as u`,
    [poolIds],
  );
  await client.query(
    `insert into public.donor_settings
       (user_id, is_available, snoozed_until, quiet_start, quiet_end, critical_overrides_quiet,
        critical_overrides_gap, max_requests_per_week, apheresis_willing)
     select r.user_id, r.is_available, r.snoozed_until, r.quiet_start, r.quiet_end,
            r.critical_overrides_quiet, r.critical_overrides_gap, r.max_requests_per_week,
            r.apheresis_willing
     from jsonb_to_recordset($1::jsonb)
       as r(user_id uuid, is_available boolean, snoozed_until timestamptz, quiet_start time,
            quiet_end time, critical_overrides_quiet boolean, critical_overrides_gap boolean,
            max_requests_per_week int, apheresis_willing boolean)`,
    [
      JSON.stringify(
        specs
          .filter((s) => s.settings !== null)
          .map((s) => ({
            user_id: s.id,
            is_available: s.settings.isAvailable,
            snoozed_until: s.settings.snoozedUntil,
            quiet_start: s.settings.quietStart,
            quiet_end: s.settings.quietEnd,
            critical_overrides_quiet: s.settings.criticalOverridesQuiet,
            critical_overrides_gap: s.settings.criticalOverridesGap,
            max_requests_per_week: s.settings.maxRequestsPerWeek,
            apheresis_willing: s.settings.apheresisWilling,
          })),
      ),
    ],
  );
  const areaRows = specs.flatMap((s) => s.areas.map((a) => ({ id: s.id, ...a })));
  await client.query(
    `insert into public.donor_areas (user_id, kind, latitude, longitude)
     select * from unnest($1::uuid[], $2::text[], $3::numeric[], $4::numeric[])`,
    [
      areaRows.map((a) => a.id),
      areaRows.map((a) => a.kind),
      areaRows.map((a) => a.lat),
      areaRows.map((a) => a.lon),
    ],
  );
  // Past asks: four closed requests hold them, one response per donor per request.
  const historyRequests = [];
  for (let slot = 0; slot < 4; slot += 1) {
    historyRequests.push(await insertRequest({ status: "cancelled" }));
  }
  await insertResponses(
    specs.flatMap((s) =>
      s.history.map((hours, slot) => ({
        request_id: historyRequests[slot],
        donor_id: s.id,
        wave: 1,
        status: "expired",
        created_at: hoursAgo(hours),
      })),
    ),
  );
  // The counters and eligibility columns are written last, whatever the triggers made of them.
  await client.query(
    `insert into public.donor_status
       (user_id, blood_group_code, is_in_network, eligible_from, eligible_until, needs_staff_check,
        screening_confirmed_at, asks_total, accepts_total, shows_total)
     select r.user_id, r.blood_group_code, r.is_in_network, r.eligible_from, r.eligible_until,
            r.needs_staff_check, r.screening_confirmed_at, r.asks_total, r.accepts_total,
            r.shows_total
     from jsonb_to_recordset($1::jsonb)
       as r(user_id uuid, blood_group_code text, is_in_network boolean, eligible_from date,
            eligible_until date, needs_staff_check boolean, screening_confirmed_at timestamptz,
            asks_total int, accepts_total int, shows_total int)
     on conflict (user_id) do update set
       blood_group_code = excluded.blood_group_code, is_in_network = excluded.is_in_network,
       eligible_from = excluded.eligible_from, eligible_until = excluded.eligible_until,
       needs_staff_check = excluded.needs_staff_check,
       screening_confirmed_at = excluded.screening_confirmed_at,
       asks_total = excluded.asks_total, accepts_total = excluded.accepts_total,
       shows_total = excluded.shows_total`,
    [
      JSON.stringify(
        specs.map((s) => ({
          user_id: s.id,
          blood_group_code: s.group,
          is_in_network: s.isInNetwork,
          eligible_from: s.eligibleFrom,
          eligible_until: s.eligibleUntil,
          needs_staff_check: s.needsStaffCheck,
          screening_confirmed_at: s.screeningConfirmedAt,
          asks_total: s.asks,
          accepts_total: s.accepts,
          shows_total: s.shows,
        })),
      ),
    ],
  );
  // Distances, as the database measures them (S11).
  const { rows: distanceRows } = await client.query(
    `select a.user_id, a.kind, (extensions.st_distance(a.cell, ${ANCHOR_SQL}) / 1000.0)::float8 as km
     from public.donor_areas a where a.user_id = any($1)`,
    [poolIds],
  );
  const specById = new Map(specs.map((s) => [s.id, s]));
  for (const row of distanceRows) {
    specById.get(row.user_id).areas.find((a) => a.kind === row.kind).km = row.km;
  }
  check(
    "the seeded donors are the only ones within 150 km of the bank",
    (await count(
      `select count(*) as n from public.donor_areas a
       where not (a.user_id = any($1)) and extensions.st_dwithin(a.cell, ${ANCHOR_SQL}, 150000)`,
      [poolIds],
    )) === 0,
  );
  check(
    "the seeded donors have a status row each, as written",
    (await count(
      "select count(*) as n from public.donor_status where user_id = any($1) and asks_total >= 0",
      [poolIds],
    )) === specs.length,
    `${specs.length} donors`,
  );

  const RULE_KEYS = {
    1: "not_in_network",
    2: "unavailable_or_snoozed",
    3: "group",
    4: "not_eligible_in_time",
    5: "screening_not_confirmed",
    6: "staff_check_pending",
    7: "not_apheresis_willing",
    8: "outside_ring",
    9: "asked_too_often",
    10: "quiet_hours",
    11: "already_asked",
    12: "the_raiser",
  };
  const tieKey = (requestId, donorId) =>
    Number.parseInt(
      crypto.createHash("md5").update(`${requestId}:${donorId}`).digest("hex").slice(0, 8),
      16,
    ) / 4294967296;
  const near = (a, b, tolerance = 1e-9) =>
    a === null || b === null || a === undefined || b === undefined
      ? a === b
      : Math.abs(a - b) < tolerance;
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  const SCENARIOS = [
    {
      name: "critical, wave 1, rural, raised by a crowd donor",
      urgency: "critical",
      wave: 1,
      units: 2,
      raiser: true,
      asked: 3,
    },
    {
      name: "urgent, wave 1, urban, B+",
      urgency: "urgent",
      wave: 1,
      units: 3,
      group: "13",
      area: "urban",
      freeFlow: 25,
      congestion: 0,
      rain: 1.15,
      neededHours: 12,
      asked: 2,
    },
    {
      name: "routine, wave 1, urban, heavy traffic and rain",
      urgency: "routine",
      wave: 1,
      units: 4,
      area: "urban",
      freeFlow: 40,
      congestion: 80,
      rain: 1.3,
      neededHours: 72,
    },
    {
      name: "critical, wave 2, rural, A+",
      urgency: "critical",
      wave: 2,
      units: 5,
      group: "11",
      freeFlow: 33.7,
      congestion: 20,
    },
    {
      name: "urgent, wave 1, rural, needed in two days",
      urgency: "urgent",
      wave: 1,
      units: 2,
      neededHours: 40,
    },
    {
      name: "critical, wave 3, compatible, whole blood for A+",
      urgency: "critical",
      wave: 3,
      units: 4,
      group: "11",
      compatible: true,
      asked: 4,
    },
    {
      name: "urgent, wave 3, compatible, red cells for AB+",
      urgency: "urgent",
      wave: 3,
      units: 3,
      group: "17",
      component: "12",
      compatible: true,
      area: "urban",
    },
    {
      name: "urgent, wave 4, compatible, plasma for AB+",
      urgency: "urgent",
      wave: 4,
      units: 2,
      group: "17",
      component: "13",
      compatible: true,
    },
    { name: "critical, wave 3, exact only", urgency: "critical", wave: 3, units: 3, group: "11" },
    { name: "critical, wave 5, widest ring", urgency: "critical", wave: 5, units: 10, asked: 5 },
    {
      name: "critical, wave 6, urban, compatible, O-",
      urgency: "critical",
      wave: 6,
      units: 6,
      group: "16",
      compatible: true,
      area: "urban",
    },
    {
      name: "routine, wave 3, urban, compatible, the last wave",
      urgency: "routine",
      wave: 3,
      units: 3,
      compatible: true,
      area: "urban",
      neededHours: 50,
    },
    {
      name: "Bombay Oh+, urgent, wave 1, one acceptance on hold",
      urgency: "urgent",
      wave: 1,
      units: 1,
      group: "22",
      area: "urban",
      holds: ["accepted"],
    },
    {
      name: "Bombay Oh+, critical, wave 3, compatible",
      urgency: "critical",
      wave: 3,
      units: 3,
      group: "22",
      compatible: true,
    },
    {
      name: "Bombay Oh-, routine, wave 2",
      urgency: "routine",
      wave: 2,
      units: 2,
      group: "23",
      neededHours: 30,
    },
    {
      name: "Bombay Oh+, critical, 30 units, fewer candidates than asked for",
      urgency: "critical",
      wave: 2,
      units: 30,
      group: "22",
    },
    {
      name: "apheresis platelets, urgent, wave 1, urban",
      urgency: "urgent",
      wave: 1,
      units: 2,
      kind: "apheresis",
      component: "18",
      area: "urban",
    },
    {
      name: "apheresis plasma, critical, wave 2",
      urgency: "critical",
      wave: 2,
      units: 2,
      kind: "apheresis",
      component: "19",
      group: "11",
    },
    {
      name: "partly covered: 3 of 5 on hold, others cancelled or no-show",
      urgency: "urgent",
      wave: 2,
      units: 4,
      donated: 1,
      holds: ["accepted", "arrived", "accepted", "cancelled", "no_show", "declined"],
    },
    {
      name: "one acceptance short of the target",
      urgency: "urgent",
      wave: 2,
      units: 2,
      holds: ["accepted", "arrived"],
    },
    {
      name: "cap of 40, critical, urban, 20 units",
      urgency: "critical",
      wave: 1,
      units: 20,
      area: "urban",
    },
    {
      name: "cap of 25, routine, urban, 20 units",
      urgency: "routine",
      wave: 1,
      units: 20,
      area: "urban",
      neededHours: 72,
    },
    {
      name: "no candidates: B-, urgent, urban, wave 2",
      urgency: "urgent",
      wave: 2,
      units: 2,
      group: "14",
      area: "urban",
    },
    {
      name: "no candidates: B-, critical, rural, wave 1",
      urgency: "critical",
      wave: 1,
      units: 2,
      group: "14",
    },
    {
      name: "covered: the target is on hold (no wave)",
      urgency: "urgent",
      wave: 2,
      units: 2,
      holds: ["accepted", "accepted", "arrived"],
      expectNull: true,
    },
    {
      name: "nothing left to donate (no wave)",
      urgency: "critical",
      wave: 2,
      units: 2,
      donated: 2,
      expectNull: true,
    },
    {
      name: "past the last wave: critical wave 7",
      urgency: "critical",
      wave: 7,
      units: 2,
      expectNull: true,
    },
    {
      name: "past the last wave: urgent wave 5",
      urgency: "urgent",
      wave: 5,
      units: 2,
      expectNull: true,
    },
    {
      name: "past the last wave: routine wave 4",
      urgency: "routine",
      wave: 4,
      units: 2,
      expectNull: true,
    },
  ];
  const sqlFilterTotals = Object.fromEntries(Object.values(RULE_KEYS).map((key) => [key, 0]));
  const seen = {
    minClamp: 0,
    capClamp: 0,
    candidateClamp: 0,
    empty: 0,
    compatibleAsked: 0,
    waves: new Set(),
    urgencies: new Set(),
  };

  for (const sc of SCENARIOS) {
    const urgency = sc.urgency;
    const group = sc.group ?? "15";
    const wave = sc.wave;
    const wavesSent = wave - 1;
    const area = sc.area ?? "rural";
    const neededBy = new Date(NOW.getTime() + (sc.neededHours ?? 6) * MS_H);
    const raisedBy = sc.raiser ? crowd[0].id : null;
    const holds = sc.holds ?? [];
    const label = sc.name;
    const id = await insertRequest({
      kind: sc.kind,
      group,
      component: sc.component,
      units: sc.units,
      urgency,
      neededBy,
      compatible: sc.compatible,
      freeFlow: sc.freeFlow,
      congestion: sc.congestion,
      rain: sc.rain,
      area,
      wavesSent: Math.min(wavesSent, 6),
      donated: sc.donated,
      createdBy: raisedBy,
    });
    await insertResponses(
      holds.map((status, index) => ({
        request_id: id,
        donor_id: bystanders[index],
        wave: 1,
        status,
        created_at: hoursAgo(1),
      })),
    );
    const askedSpecs = specs
      .filter((s) => s.group === group && s.areas.length > 0)
      .slice(-(sc.asked ?? 0))
      .slice(0, sc.asked ?? 0);
    const askedIds = new Set(askedSpecs.map((s) => s.id));
    await insertResponses(
      askedSpecs.map((s) => ({
        request_id: id,
        donor_id: s.id,
        wave: 1,
        status: "expired",
        created_at: hoursAgo(2),
      })),
    );

    const donors = specs.map((s) => {
      const hours = [...s.history, ...(askedIds.has(s.id) ? [2] : [])];
      return {
        id: s.id,
        status: {
          isInNetwork: s.isInNetwork,
          eligibleFrom: s.eligibleFrom,
          eligibleUntil: s.eligibleUntil,
          needsStaffCheck: s.needsStaffCheck,
          screeningConfirmedAt: s.screeningConfirmedAt,
          bloodGroupCode: s.group,
          asksTotal: s.asks,
          acceptsTotal: s.accepts,
          showsTotal: s.shows,
        },
        settings: s.settings ?? {},
        areas: s.areas.map((a) => ({ kind: a.kind, distanceKm: a.km })),
        asksLast7Days: hours.filter((h) => h < 168).length,
        lastAskedAt: hours.length ? hoursAgo(Math.min(...hours)) : null,
        alreadyAsked: askedIds.has(s.id),
      };
    });
    const request = {
      urgency,
      group,
      component: sc.component ?? "11",
      allowCompatible: sc.compatible ?? false,
      isApheresis: sc.kind === "apheresis",
      neededBy,
      raisedBy: raisedBy ?? undefined,
      area,
      unitsNeeded: sc.units,
      unitsDonated: sc.donated ?? 0,
      wavesSent,
      acceptedOnHold: holds.filter((s) => s === "accepted" || s === "arrived").length,
      conditions: {
        freeFlowKmh: sc.freeFlow ?? 30,
        congestionPercent: sc.congestion ?? 50,
        rainFactor: sc.rain ?? 1,
      },
    };
    const ids = donors.map((d) => d.id).sort((a, b) => String(a).localeCompare(String(b)));
    const keys = new Map(ids.map((donorId) => [donorId, tieKey(id, donorId)]));
    let draw = 0;
    const plan = planWave(request, donors, NOW, { random: () => keys.get(ids[draw++]) });

    const returned = (await one("select public.match_wave($1) as k", [id])).k;
    const asked = (
      await client.query(
        `select donor_id, score, est_minutes, is_exact_group from public.request_responses
         where request_id = $1 and status = 'notified' order by id`,
        [id],
      )
    ).rows;
    const waveRow = await waveOf(id, wave);
    const after = await requestRow(id);

    if (plan === null) {
      check(
        `${label}: planWave() and match_wave() both send nothing`,
        sc.expectNull === true && returned === 0 && asked.length === 0 && !waveRow,
        `returned ${returned}, ${asked.length} asked`,
      );
      check(
        `${label}: the request is left as it was`,
        after.waves_sent === Math.min(wavesSent, 6),
        `${after.waves_sent} waves`,
      );
    } else {
      check(
        `${label}: asks the same donors in the same order (${plan.asks.length} of ${plan.candidateCount})`,
        sc.expectNull !== true &&
          returned === plan.k &&
          asked.length === plan.asks.length &&
          asked.every((row, index) => row.donor_id === plan.asks[index].donorId),
        `returned ${returned}, planned ${plan.k}`,
      );
      check(
        `${label}: scores, minutes and exact flags agree to 1e-9`,
        asked.length === plan.asks.length &&
          asked.every(
            (row, index) =>
              near(row.score, plan.asks[index].score) &&
              near(row.est_minutes, plan.asks[index].estMinutes) &&
              row.is_exact_group === plan.asks[index].exact,
          ),
      );
      const widest = area === "rural" ? 150 : 25;
      const expectedCounts = Object.fromEntries(Object.values(RULE_KEYS).map((key) => [key, 0]));
      for (const donor of donors) {
        if (!donor.areas.some((a) => a.distanceKm <= widest)) continue;
        for (const rule of passesHardFilters(donor, request, plan.wave, NOW).failed) {
          expectedCounts[RULE_KEYS[rule]] += 1;
        }
      }
      check(
        `${label}: filter_counts agree`,
        waveRow &&
          Object.keys(expectedCounts).every(
            (key) => waveRow.filter_counts[key] === expectedCounts[key],
          ) &&
          Object.keys(waveRow.filter_counts).length === 12,
        waveRow ? JSON.stringify(waveRow.filter_counts) : "no wave row",
      );
      for (const [key, value] of Object.entries(waveRow?.filter_counts ?? {})) {
        sqlFilterTotals[key] += value;
      }
      const askedSpecsKm = plan.asks.map((ask) => {
        const donor = donors.find((d) => d.id === ask.donorId);
        return Math.min(
          ...donor.areas.filter((a) => a.distanceKm <= plan.ringKm).map((a) => a.distanceKm),
        );
      });
      const bands = [
        askedSpecsKm.filter((km) => km <= 5).length,
        askedSpecsKm.filter((km) => km > 5 && km <= 10).length,
        askedSpecsKm.filter((km) => km > 10 && km <= 15).length,
        askedSpecsKm.filter((km) => km > 15 && km <= 25).length,
        askedSpecsKm.filter((km) => km > 25).length,
      ];
      const scores = plan.asks.map((ask) => ask.score);
      check(
        `${label}: the wave row agrees (ring ${plan.ringKm}, p_accept ${plan.pAccept.toFixed(4)}, k ${plan.k})`,
        waveRow &&
          waveRow.ring_km === plan.ringKm &&
          waveRow.candidate_count === plan.candidateCount &&
          waveRow.k === plan.k &&
          near(waveRow.p_accept, plan.pAccept) &&
          waveRow.exact_count === plan.asks.filter((a) => a.exact).length &&
          waveRow.compatible_count === plan.asks.filter((a) => !a.exact).length &&
          JSON.stringify(waveRow.distance_bands) === JSON.stringify(bands) &&
          near(waveRow.score_min, scores.length ? Math.min(...scores) : null) &&
          near(waveRow.score_median, scores.length ? median(scores) : null) &&
          near(waveRow.score_max, scores.length ? Math.max(...scores) : null),
        JSON.stringify(waveRow),
      );
      check(
        `${label}: waves_sent is ${plan.wave} and the next wave is due after the gap`,
        after.waves_sent === plan.wave &&
          near(after.wait_s, WAVE_SETTINGS[urgency].gapMinutes * 60, 1e-3),
        JSON.stringify(after),
      );

      const { cap, minDonors } = WAVE_SETTINGS[urgency];
      const raw = Math.ceil(Math.round((plan.wanted / plan.pAccept) * 1e9) / 1e9);
      if (plan.candidateCount === 0) seen.empty += 1;
      else if (raw < minDonors && plan.candidateCount >= minDonors && plan.k === minDonors)
        seen.minClamp += 1;
      if (raw > cap && plan.candidateCount > cap && plan.k === cap) seen.capClamp += 1;
      if (
        plan.candidateCount > 0 &&
        plan.candidateCount < Math.min(Math.max(raw, minDonors), cap)
      ) {
        if (plan.k === plan.candidateCount) seen.candidateClamp += 1;
      }
      if (plan.asks.some((a) => !a.exact)) seen.compatibleAsked += 1;
      seen.waves.add(plan.wave);
      seen.urgencies.add(urgency);
    }
    await client.query("delete from public.blood_requests where id = $1", [id]);
  }
  check(
    "every one of the 12 hard filters removed someone in some wave",
    Object.values(sqlFilterTotals).every((total) => total > 0),
    JSON.stringify(sqlFilterTotals),
  );
  check(
    "the waves covered critical, urgent and routine, waves 1 to 6, and compatible groups",
    seen.urgencies.size === 3 &&
      [1, 2, 3, 4, 5, 6].every((w) => seen.waves.has(w)) &&
      seen.compatibleAsked >= 2,
    `${[...seen.waves].join(",")}; ${seen.compatibleAsked} with compatible donors`,
  );
  check(
    "the minimum, the cap, the candidate count and an empty wave were each the limit in some wave",
    seen.minClamp > 0 && seen.capClamp >= 2 && seen.candidateClamp > 0 && seen.empty >= 2,
    JSON.stringify({ ...seen, waves: undefined, urgencies: undefined }),
  );

  // ── the status after advance_requests(): covered, back to open, and the end states ──
  // Every case is a real request, inserted directly with the stated counts; one call to
  // advance_requests() processes them all, and each ends up where nextRequestStatus() says
  // (after the wave that call runs for a due request that is still before its needed-by).
  const STATUS_CASES = [];
  for (const urgency of ["critical", "urgent", "routine"]) {
    const target = waveTarget(2, urgency);
    for (const holdCount of [0, target - 1, target, target + 1]) {
      for (const lastWave of [false, true]) {
        for (const due of [false, true]) {
          STATUS_CASES.push({
            urgency,
            units: 2,
            donated: 0,
            holdCount,
            lastWave,
            due,
            neededHours: 6,
          });
        }
      }
    }
  }
  for (const urgency of ["critical", "urgent", "routine"]) {
    const target = waveTarget(2, urgency);
    STATUS_CASES.push(
      { urgency, units: 2, donated: 2, holdCount: 0, due: true, neededHours: 6 },
      { urgency, units: 3, donated: 1, holdCount: 1, due: true, neededHours: -1 },
      { urgency, units: 2, donated: 0, holdCount: 0, due: true, neededHours: -1 },
      { urgency, units: 2, donated: 0, holdCount: target, due: false, neededHours: -1 },
      { urgency, units: 3, donated: 1, holdCount: 0, lastWave: true, due: true, neededHours: 6 },
      { urgency, units: 3, donated: 1, holdCount: 0, lastWave: true, due: false, neededHours: 6 },
    );
  }
  const HOLD_STATUSES = ["accepted", "arrived", "accepted", "arrived"];
  const NOISE = ["cancelled", "no_show", "declined"];
  const startedCases = [];
  for (const [index, c] of STATUS_CASES.entries()) {
    const set = WAVE_SETTINGS[c.urgency];
    const wavesSent = c.lastWave ? set.maxWaves : 1;
    const nextWaveAt = new Date(NOW.getTime() + (c.due ? -5 : 5) * 60_000);
    const neededBy = new Date(NOW.getTime() + c.neededHours * MS_H);
    const status = index % 2 === 0 ? "open" : "covered";
    const id = await insertRequest({
      urgency: c.urgency,
      units: c.units,
      donated: c.donated,
      wavesSent,
      nextWaveAt,
      neededBy,
      status,
      group: "13",
      area: "urban",
    });
    const rows = [...HOLD_STATUSES.slice(0, c.holdCount), ...(c.holdCount > 0 ? NOISE : [])].map(
      (s, n) => ({
        request_id: id,
        donor_id: bystanders[n],
        wave: 1,
        status: s,
        created_at: hoursAgo(1),
      }),
    );
    await insertResponses(rows);
    startedCases.push({ ...c, id, wavesSent, nextWaveAt, neededBy });
  }
  await asPostgres();
  const advanced = (await one("select public.advance_requests() as n")).n;
  let wavesRun = 0;
  let wrong = [];
  let lateWaves = 0;
  for (const c of startedCases) {
    const set = WAVE_SETTINGS[c.urgency];
    const row = await requestRow(c.id);
    const wave = c.wavesSent + 1;
    const ran =
      c.nextWaveAt <= NOW &&
      NOW < c.neededBy &&
      wave <= set.maxWaves &&
      waveTarget(c.units - c.donated, c.urgency) - c.holdCount > 0;
    if (ran) wavesRun += 1;
    const expected = nextRequestStatus(
      {
        status: "open",
        unitsNeeded: c.units,
        unitsDonated: c.donated,
        acceptedOnHold: c.holdCount,
        wavesSent: ran ? wave : c.wavesSent,
        urgency: c.urgency,
        neededBy: c.neededBy,
        nextWaveAt: ran ? new Date(NOW.getTime() + set.gapMinutes * 60_000) : c.nextWaveAt,
      },
      NOW,
    );
    const open = expected === "open" || expected === "covered";
    if (
      row.status !== expected ||
      row.waves_sent !== (ran ? wave : c.wavesSent) ||
      (row.closed_at === null) !== open
    ) {
      wrong.push(
        `${c.urgency} units ${c.units}/${c.donated} holds ${c.holdCount} last ${Boolean(c.lastWave)} due ${c.due} by ${c.neededHours}h: ${row.status}/${row.waves_sent}, expected ${expected}/${ran ? wave : c.wavesSent}`,
      );
    }
    if (c.nextWaveAt <= NOW && NOW >= c.neededBy && row.waves_sent !== c.wavesSent) lateWaves += 1;
  }
  check(
    `advance_requests() leaves each of ${startedCases.length} requests where nextRequestStatus() says`,
    wrong.length === 0,
    wrong.slice(0, 3).join("; "),
  );
  check(
    "and it ran waves only for the requests that were due, before their needed-by and short of acceptances",
    wavesRun > 0 && advanced > 0,
    `${wavesRun} waves, ${advanced} donors asked`,
  );
  check("no wave runs for a request whose needed-by has passed", lateWaves === 0);
  const statuses = new Set(
    (
      await client.query("select distinct status from public.blood_requests where id = any($1)", [
        startedCases.map((c) => c.id),
      ])
    ).rows.map((r) => r.status),
  );
  check(
    "the cases ended open, covered, fulfilled, partly fulfilled and expired",
    ["open", "covered", "fulfilled", "partly_fulfilled", "expired"].every((s) => statuses.has(s)),
    [...statuses].join(","),
  );
  await client.query("delete from public.blood_requests where id = any($1)", [
    startedCases.map((c) => c.id),
  ]);

  // One request through covered and back to open.
  const flowSet = WAVE_SETTINGS.critical;
  const flowNeeded = new Date(NOW.getTime() + 6 * MS_H);
  const flowId = await insertRequest({
    urgency: "critical",
    units: 2,
    wavesSent: 1,
    nextWaveAt: new Date(NOW.getTime() + 5 * 60_000),
    neededBy: flowNeeded,
    group: "13",
    area: "urban",
  });
  await insertResponses(
    ["accepted", "arrived", "accepted"].map((status, n) => ({
      request_id: flowId,
      donor_id: bystanders[n],
      wave: 1,
      status,
      created_at: hoursAgo(1),
    })),
  );
  const flowStep = async () => {
    await client.query("select public.advance_requests()");
    return requestRow(flowId);
  };
  let flow = await flowStep();
  check(
    "3 acceptances on hold for 2 units (target 3): open becomes covered, and no wave runs",
    flow.status === "covered" && flow.closed_at === null && flow.waves_sent === 1,
    JSON.stringify(flow),
  );
  await client.query(
    "update public.request_responses set status = 'cancelled' where request_id = $1 and donor_id = $2",
    [flowId, bystanders[2]],
  );
  flow = await flowStep();
  check(
    "one acceptance cancels: covered goes back to open, and nothing is sent before the next wave is due",
    flow.status === "open" && flow.closed_at === null && flow.waves_sent === 1,
    JSON.stringify(flow),
  );
  await client.query("update public.blood_requests set next_wave_at = $2 where id = $1", [
    flowId,
    new Date(NOW.getTime() - 60_000),
  ]);
  flow = await flowStep();
  const flowWave = await waveOf(flowId, 2);
  check(
    "when the next wave is due it runs for the one acceptance missing, and the request stays open",
    flow.status === "open" &&
      flow.waves_sent === 2 &&
      flowWave !== undefined &&
      near(flow.wait_s, flowSet.gapMinutes * 60, 1e-3),
    JSON.stringify(flow),
  );
  await client.query(
    "update public.request_responses set status = 'accepted' where request_id = $1 and donor_id = $2",
    [flowId, bystanders[2]],
  );
  await client.query(
    "update public.blood_requests set waves_sent = $2, next_wave_at = $3 where id = $1",
    [flowId, flowSet.maxWaves, new Date(NOW.getTime() - 60_000)],
  );
  flow = await flowStep();
  check(
    "a covered request stays covered after the last wave, not ended as 'all waves sent'",
    flow.status === "covered" && flow.closed_at === null && flow.close_reason === null,
    JSON.stringify(flow),
  );
  await client.query(
    "update public.request_responses set status = 'cancelled' where request_id = $1 and donor_id = any($2)",
    [flowId, [bystanders[1], bystanders[2]]],
  );
  flow = await flowStep();
  check(
    "after the last wave and its gap, with the acceptances gone, an empty request expires",
    flow.status === "expired" && flow.closed_at !== null && flow.close_reason === "All waves sent",
    JSON.stringify(flow),
  );
  await client.query("delete from public.blood_requests where id = $1", [flowId]);

  const doneId = await insertRequest({
    urgency: "urgent",
    units: 2,
    wavesSent: 1,
    nextWaveAt: new Date(NOW.getTime() + 5 * 60_000),
    neededBy: flowNeeded,
    group: "13",
    area: "urban",
    donated: 2,
  });
  await client.query("select public.advance_requests()");
  const done = await requestRow(doneId);
  check(
    "units donated close the request as fulfilled with its reason",
    done.status === "fulfilled" && done.close_reason === "Units donated" && done.closed_at !== null,
    JSON.stringify(done),
  );
  await client.query("delete from public.blood_requests where id = $1", [doneId]);

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

  // A donor who was asked, and the member who raised the requests.
  await asUser(nearDonors[1]);
  check(
    "delete_my_account() works for a donor with request_responses rows",
    (await errorCode("select public.delete_my_account()")) === null,
  );
  await asPostgres();
  check(
    "and their responses go with them",
    (await count("select count(*) as n from public.request_responses where donor_id = $1", [
      nearDonors[1],
    ])) === 0,
  );
  await asUser(bankMember);
  check(
    "delete_my_account() works for the member who raised requests",
    (await errorCode("select public.delete_my_account()")) === null,
  );
  await asPostgres();
  check(
    "and the organization's requests, waves and responses go with it",
    (await count("select count(*) as n from public.blood_requests where organization_id = $1", [
      bankOrg,
    ])) === 0 &&
      (await count("select count(*) as n from public.request_responses where request_id = $1", [
        r1,
      ])) === 0,
  );
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
