import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { getStateName } from "@/lib/constants";
import { OVERDUE_GRACE_HOURS, collectionOverdue, intervalHours } from "@/lib/collector";
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

// The last finished stock run, from the cloud or the laptop, and a red warning when
// none has finished within the sweep interval plus 2 hours. Shows nothing until the
// cloud collector's migration has added collector_runs.
function LastSweepLine({ lastRun, lastSweep }) {
  if (lastRun.error || lastSweep.error) return null;
  const run = lastRun.data?.[0];
  const interval = lastSweep.data?.[0]?.sweep_interval ?? null;
  const { isOverdue, hoursSince, limitHours } = collectionOverdue(run?.finished_at, interval);
  return (
    <>
      <p className="card-body text-sm">
        {run
          ? `Last sweep: ${run.batch ? `batch ${run.batch} ` : ""}from ${run.runner === "edge" ? "Supabase" : "the laptop"}, finished ${formatDateTime(run.finished_at)}, ${run.states_saved ?? 0} states saved${run.states_failed ? `, ${run.states_failed} failed` : ""}${run.states_skipped ? `, ${run.states_skipped} skipped` : ""}.`
          : "No sweep has been recorded yet."}
        {interval && ` Sweeps every ${intervalHours(interval)} hours.`}
      </p>
      {isOverdue && run && (
        <p className="card-body notice notice-error">
          No sweep has finished for {hoursSince.toFixed(1)} hours, more than the{" "}
          {limitHours - OVERDUE_GRACE_HOURS}-hour interval plus {OVERDUE_GRACE_HOURS} hours. Check
          collector_runs and the cron jobs.
        </p>
      )}
    </>
  );
}

// eRaktKosh health over the last 24 hours, from the collector's call log
// (the upstream_stats view; admins only). Worst-served states first.
function CollectionHealthCard({ stats }) {
  if (stats.error) {
    return (
      <p className="card-body notice notice-error">
        Could not load collection health: {stats.error.message}
      </p>
    );
  }
  const rows = stats.data ?? [];
  if (rows.length === 0) {
    return (
      <p className="card-body text-sm text-[#666]">
        No eRaktKosh calls in the last 24 hours. Is the hourly collector (npm run snapshot) running?
      </p>
    );
  }
  const totalCalls = rows.reduce((sum, row) => sum + row.calls, 0);
  const okCalls = rows.reduce((sum, row) => sum + row.ok_calls, 0);
  const stateRows = rows
    .filter((row) => row.endpoint === "blood-availability")
    .sort((a, b) => (a.last_ok_at ?? "").localeCompare(b.last_ok_at ?? ""));
  return (
    <>
      <p className="card-body text-sm">
        {totalCalls} calls, {((100 * okCalls) / totalCalls).toFixed(1)}% succeeded. Slowest
        95th-percentile time: {Math.max(...rows.map((row) => Number(row.p95_ms)))} ms.
      </p>
      <ul>
        {stateRows.slice(0, 8).map((row) => (
          <li key={row.state_code} className="result-item text-sm">
            <span className="font-semibold">{getStateName(row.state_code) ?? row.state_code}</span>
            <span className="text-[#666]">
              {" "}
              · {row.success_pct}% ok · median {row.median_ms} ms · last good fetch{" "}
              {row.last_ok_at ? formatDateTime(row.last_ok_at) : "none"}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
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
    collectionStats,
    lastRun,
    lastSweep,
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
    supabase.from("upstream_stats").select("*"),
    supabase
      .from("collector_runs")
      .select("runner, batch, finished_at, states_saved, states_failed, states_skipped")
      .eq("job", "stock")
      .not("finished_at", "is", null)
      .order("finished_at", { ascending: false })
      .limit(1),
    supabase
      .from("collector_sweeps")
      .select("sweep_interval")
      .order("started_at", { ascending: false })
      .limit(1),
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
        <h2 className="card-title">eRaktKosh data collection, last 24 hours</h2>
        <LastSweepLine lastRun={lastRun} lastSweep={lastSweep} />
        <CollectionHealthCard stats={collectionStats} />
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
