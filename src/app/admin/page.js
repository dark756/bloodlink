import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import OrganizationCard, { ORGANIZATION_SELECT } from "./OrganizationCard";

// Select options that return only the row count, not the rows.
const COUNT_ONLY = { count: "exact", head: true };

async function countRows(query) {
  const { count } = await query;
  return count ?? 0;
}

function StatCard({ label, value, href }) {
  const card = (
    <div className="card card-body">
      <div className="text-2xl font-bold text-[#222]">{value}</div>
      <div className="text-xs text-[#666] mt-1">{label}</div>
    </div>
  );
  return href ? <Link href={href}>{card}</Link> : card;
}

export default async function AdminOverviewPage() {
  const supabase = await createClient();

  const [
    userCount,
    completeProfileCount,
    donorCount,
    adminCount,
    pendingCount,
    approvedCount,
    pendingApplications,
    recentAuditEntries,
  ] = await Promise.all([
    countRows(supabase.from("profiles").select("id", COUNT_ONLY)),
    countRows(supabase.from("profiles").select("id", COUNT_ONLY).eq("is_profile_complete", true)),
    countRows(supabase.from("profiles").select("id", COUNT_ONLY).eq("is_donor", true)),
    countRows(supabase.from("profiles").select("id", COUNT_ONLY).eq("role", "admin")),
    countRows(supabase.from("organizations").select("id", COUNT_ONLY).eq("status", "pending")),
    countRows(supabase.from("organizations").select("id", COUNT_ONLY).eq("status", "approved")),
    supabase
      .from("organizations")
      .select(ORGANIZATION_SELECT)
      .eq("status", "pending")
      .order("created_at")
      .limit(20),
    supabase
      .from("audit_log")
      .select("id, action, target_type, created_at, actor:profiles!audit_log_actor_id_fkey(email)")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);
  const auditEntries = recentAuditEntries.data ?? [];

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label="Accounts" value={userCount} href="/admin/users" />
        <StatCard label="Completed profiles" value={completeProfileCount} />
        <StatCard label="Registered donors" value={donorCount} />
        <StatCard
          label="Pending verifications"
          value={pendingCount}
          href="/admin/organizations?status=pending"
        />
        <StatCard
          label="Verified organizations"
          value={approvedCount}
          href="/admin/organizations?status=approved"
        />
        <StatCard label="Admins" value={adminCount} href="/admin/users?role=admin" />
      </div>

      <div className="card mt-5">
        <h2 className="card-title">
          Waiting for verification ({pendingApplications.data?.length ?? 0})
        </h2>
        {pendingApplications.error ? (
          <p className="card-body notice notice-error">
            Could not load applications: {pendingApplications.error.message}
          </p>
        ) : pendingApplications.data.length === 0 ? (
          <p className="card-body text-sm text-[#666]">Nothing to review right now.</p>
        ) : (
          <ul>
            {pendingApplications.data.map((organization) => (
              <OrganizationCard key={organization.id} organization={organization} />
            ))}
          </ul>
        )}
      </div>

      <div className="card mt-5">
        <h2 className="card-title">Recent activity</h2>
        <ul>
          {auditEntries.map((entry) => (
            <li key={entry.id} className="result-item text-sm">
              <span className="font-semibold">{entry.action}</span>
              <span className="text-[#666]">
                {" "}
                by {entry.actor?.email ?? "system"} · {formatDateTime(entry.created_at)}
              </span>
            </li>
          ))}
          {auditEntries.length === 0 && (
            <li className="result-item text-sm text-[#666]">No activity yet.</li>
          )}
        </ul>
        <p className="card-body text-xs">
          <Link href="/admin/audit" className="text-[#d32f2f] font-semibold">
            Full audit log →
          </Link>
        </p>
      </div>
    </>
  );
}
