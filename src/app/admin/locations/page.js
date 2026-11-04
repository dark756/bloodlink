import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDistrictName, getStateName } from "@/lib/constants";
import { parseQuantities } from "@/lib/stock";
import { METHOD_LABELS, REASON_LABELS } from "@/lib/bankLocations";
import LocationReview from "./LocationReview";

// The banks location search can't place, and the positions waiting for review (#33,
// #34; docs/PLANS/plan_bank_locations.md, Part B). Worst first: the most units held,
// then those with no position at all. Reads bank_location_queue, which only admins see
// in full.

const FILTERS = {
  all: "All",
  proposed: "Waiting for review",
  unplaced: "No position yet",
  rejected: "Rejected or can't place",
};
const PAGE_SIZE = 25;
const QUEUE_SELECT =
  "hospital_code, state_code, district_id, name, address, bank_type, components, entry_at, location_quality, eraktkosh_latitude, eraktkosh_longitude, fix_status, fix_method, fix_latitude, fix_longitude, fix_precision_m, fix_evidence, fix_reviewed_at";

// Every unit a bank lists, across components and groups.
function unitsHeld(components) {
  return Object.values(components ?? {}).reduce(
    (sum, component) =>
      sum +
      parseQuantities(component?.available_WithQty).reduce(
        (total, entry) => total + entry.units,
        0,
      ),
    0,
  );
}

const filterOf = (row) =>
  row.fix_status === "proposed"
    ? "proposed"
    : row.fix_status === "rejected"
      ? "rejected"
      : "unplaced";

export default async function AdminLocationsPage({ searchParams }) {
  const params = await searchParams;
  const filter = Object.hasOwn(FILTERS, params?.filter) ? params.filter : "all";
  const page = Math.max(1, Number.parseInt(params?.page, 10) || 1);

  const supabase = await createClient();
  const rows = [];
  let error = null;
  for (let from = 0; ; from += 1000) {
    const answer = await supabase
      .from("bank_location_queue")
      .select(QUEUE_SELECT)
      .order("hospital_code")
      .range(from, from + 999);
    if (answer.error) {
      error = answer.error;
      break;
    }
    rows.push(...answer.data);
    if (answer.data.length < 1000) break;
  }

  if (error) {
    return (
      <div className="card">
        <p className="card-body notice notice-error">
          Could not load the location queue: {error.message}. It needs the migration
          20261105000100_bank_location_fixes.sql (npm run db:migrate).
        </p>
      </div>
    );
  }

  const counts = { all: rows.length, proposed: 0, unplaced: 0, rejected: 0 };
  for (const row of rows) counts[filterOf(row)] += 1;
  const banks = rows
    .filter((row) => filter === "all" || filterOf(row) === filter)
    .map((row) => ({ ...row, units: unitsHeld(row.components) }))
    .sort(
      (a, b) =>
        Number(b.fix_status === "proposed") - Number(a.fix_status === "proposed") ||
        b.units - a.units ||
        Number(a.fix_latitude !== null) - Number(b.fix_latitude !== null) ||
        a.hospital_code.localeCompare(b.hospital_code),
    );
  const pages = Math.max(1, Math.ceil(banks.length / PAGE_SIZE));
  const shown = banks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hrefFor = (nextFilter, nextPage = 1) =>
    `/admin/locations?filter=${nextFilter}${nextPage > 1 ? `&page=${nextPage}` : ""}`;

  return (
    <div className="card">
      <div className="card-title">
        <h2>Bank locations</h2>
        <p className="text-xs font-normal text-[#666] mt-1">
          Stocked banks location search can&apos;t place, and positions found for them. An accepted
          position goes into location search within the hour. Check each against the bank&apos;s
          address: a bank placed in the wrong town is worse than one not placed.
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          {Object.entries(FILTERS).map(([key, label]) => (
            <Link
              key={key}
              href={hrefFor(key)}
              className={key === filter ? "badge badge-red" : "badge"}
            >
              {label} ({counts[key]})
            </Link>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="card-body text-sm text-[#666]">Nothing here.</p>
      ) : (
        <ul>
          {shown.map((bank) => (
            <LocationReview
              key={bank.hospital_code}
              bank={{
                hospitalCode: bank.hospital_code,
                stateCode: bank.state_code,
                name: bank.name || "Blood bank",
                address: bank.address ?? "",
                type: bank.bank_type,
                units: bank.units,
                place: [
                  getDistrictName(bank.state_code, bank.district_id),
                  getStateName(bank.state_code),
                ]
                  .filter(Boolean)
                  .join(", "),
                reason: REASON_LABELS[bank.location_quality] ?? bank.location_quality,
                fix:
                  bank.fix_latitude === null
                    ? null
                    : {
                        status: bank.fix_status,
                        method: METHOD_LABELS[bank.fix_method] ?? bank.fix_method,
                        latitude: bank.fix_latitude,
                        longitude: bank.fix_longitude,
                        precisionM: bank.fix_precision_m,
                        evidence: bank.fix_evidence ?? {},
                      },
              }}
            />
          ))}
        </ul>
      )}
      {pages > 1 && (
        <div className="card-body flex flex-wrap gap-2 text-sm">
          {page > 1 && (
            <Link href={hrefFor(filter, page - 1)} className="btn btn-outline btn-small">
              Previous
            </Link>
          )}
          <span className="text-[#666]">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link href={hrefFor(filter, page + 1)} className="btn btn-outline btn-small">
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
