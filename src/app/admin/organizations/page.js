import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ORGANIZATION_STATUS_LABELS } from "@/lib/organization";
import OrganizationCard, { ORGANIZATION_SELECT } from "../OrganizationCard";

const STATUS_FILTERS = ["all", "pending", "approved", "rejected", "suspended"];

export default async function AdminOrganizationsPage({ searchParams }) {
  const params = await searchParams;
  const status = STATUS_FILTERS.includes(params?.status) ? params.status : "all";

  const supabase = await createClient();
  let query = supabase
    .from("organizations")
    .select(ORGANIZATION_SELECT)
    .order("created_at", { ascending: false })
    .limit(100);
  if (status !== "all") query = query.eq("status", status);
  const { data, error } = await query;

  return (
    <div className="card">
      <div className="card-title flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => (
          <Link
            key={filter}
            href={
              filter === "all" ? "/admin/organizations" : `/admin/organizations?status=${filter}`
            }
            className={filter === status ? "badge badge-red" : "badge"}
          >
            {filter === "all" ? "All" : ORGANIZATION_STATUS_LABELS[filter]}
          </Link>
        ))}
      </div>
      {error ? (
        <p className="card-body notice notice-error">
          Could not load organizations: {error.message}
        </p>
      ) : data.length === 0 ? (
        <p className="card-body text-sm text-[#666]">No organizations here.</p>
      ) : (
        <ul>
          {data.map((organization) => (
            <OrganizationCard key={organization.id} organization={organization} />
          ))}
        </ul>
      )}
    </div>
  );
}
