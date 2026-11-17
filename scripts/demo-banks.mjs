// Two demo blood banks for a presentation, each flagged by an admin stock-out event so
// the donate suggestions show them to a nearby eligible donor. They are named "DEMO"
// and use codes 99000001 and 99000002, which eRaktKosh does not issue.
//
//   node scripts/demo-banks.mjs --create     add the banks and open one event per blood group
//   node scripts/demo-banks.mjs --remove     delete the banks and every event for them
//   node scripts/demo-banks.mjs --status     show what exists
//
// The events show only while the admin_events flag is on (/admin/events).
import pg from "pg";

const GROUPS = ["11", "12", "13", "14", "15", "16", "17", "18"];
const COMPONENT = "12";
const EVENT_HOURS = 72;
const BANKS = [
  {
    code: "99000001",
    name: "DEMO Hospital (Home)",
    address: "Demo location, Airoli, Navi Mumbai, Thane, Maharashtra",
    latitude: 19.182703,
    longitude: 72.993786,
    district: "517",
  },
  {
    code: "99000002",
    name: "DEMO Hospital (Uni)",
    address: "Demo location, Chembur, Mumbai, Maharashtra",
    latitude: 19.072791,
    longitude: 72.899911,
    district: "519",
  },
];
const CODES = BANKS.map((bank) => bank.code);

process.loadEnvFile(".env.local");
const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const mode = process.argv[2];

try {
  if (mode === "--create") {
    for (const bank of BANKS) {
      await client.query(
        `insert into public.blood_banks
           (hospital_code, name, address, state_code, district_id, latitude, longitude,
            location_quality, bank_type, hospital_type)
         values ($1, $2, $3, '27', $4, $5, $6, 'ok', 'Blood Bank', 'Charitable/Vol')
         on conflict (hospital_code) do update set name = excluded.name,
           address = excluded.address, latitude = excluded.latitude, longitude = excluded.longitude,
           location_quality = 'ok', last_seen_at = now()`,
        [bank.code, bank.name, bank.address, bank.district, bank.latitude, bank.longitude],
      );
    }
    await client.query(`delete from public.admin_stock_events where hospital_code = any ($1)`, [
      CODES,
    ]);
    for (const code of CODES) {
      for (const group of GROUPS) {
        await client.query(
          `insert into public.admin_stock_events
             (hospital_code, component_id, blood_group_code, window_hours, reason, ends_at)
           values ($1, $2, $3, $4, 'Demo: low stock at a demo blood bank', now() + make_interval(hours => $5))`,
          [code, COMPONENT, group, EVENT_HOURS, EVENT_HOURS],
        );
      }
    }
    console.log(`created ${BANKS.length} demo banks, ${CODES.length * GROUPS.length} events`);
  } else if (mode === "--remove") {
    const events = await client.query(
      `delete from public.admin_stock_events where hospital_code = any ($1)`,
      [CODES],
    );
    const banks = await client.query(
      `delete from public.blood_banks where hospital_code = any ($1)`,
      [CODES],
    );
    console.log(`removed ${banks.rowCount} demo banks, ${events.rowCount} events`);
  } else if (mode === "--status") {
    const banks = await client.query(
      `select hospital_code, name, latitude, longitude from public.blood_banks where hospital_code = any ($1)`,
      [CODES],
    );
    const events = await client.query(
      `select hospital_code, count(*) n, max(ends_at) ends_at from public.admin_stock_events
       where hospital_code = any ($1) and ended_at is null group by 1`,
      [CODES],
    );
    console.table(banks.rows);
    console.table(events.rows);
  } else {
    console.log("usage: node scripts/demo-banks.mjs --create | --remove | --status");
  }
} finally {
  await client.end();
}
