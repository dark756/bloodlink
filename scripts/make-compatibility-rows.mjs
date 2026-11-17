// Prints the INSERT for blood_compatibility (supabase/migrations/20261117000200_donor_requests.sql):
// for every recipient blood group and component category, the donor groups
// donorGroupsFor() in src/lib/compatibility.js gives, Bombay included. The migration holds
// this output; scripts/check-donor-network.mjs compares the table with donorGroupsFor again.
//
//   node scripts/make-compatibility-rows.mjs

import "./register-src.mjs";

const { donorGroupsFor, componentCategory } = await import("../src/lib/compatibility.js");
const { BLOOD_GROUPS, COMPONENTS } = await import("../src/lib/constants.js");

// One component code per category; every code of a category gives the same groups.
const representatives = new Map();
for (const component of COMPONENTS) {
  const category = componentCategory(component.code);
  if (category && !representatives.has(category)) representatives.set(category, component.code);
}

const rows = [];
for (const recipient of BLOOD_GROUPS) {
  for (const [category, componentCode] of representatives) {
    for (const donor of donorGroupsFor(recipient.code, componentCode)) {
      rows.push([recipient.code, category, donor.code]);
    }
  }
}
rows.sort(
  (a, b) => a[1].localeCompare(b[1]) || Number(a[0]) - Number(b[0]) || Number(a[2]) - Number(b[2]),
);

console.log(
  "insert into public.blood_compatibility (recipient_code, component_category, donor_code) values",
);
console.log(rows.map(([r, c, d]) => `  ('${r}', '${c}', '${d}')`).join(",\n") + ";");
console.error(`${rows.length} rows`);
