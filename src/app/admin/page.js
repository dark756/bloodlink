import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { getStateName } from "@/lib/constants";
import { OVERDUE_GRACE_HOURS, collectionOverdue, intervalHours } from "@/lib/collector";
import { forecastOverdue } from "@/lib/stockoutModel";
import OrganizationCard, { ORGANIZATION_SELECT } from "./OrganizationCard";
import { FlagToggle } from "./AdminActions";

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

const FORECAST_FLAGS = [
  ["forecast_badge", 'the "may run low soon" mark in search'],
  ["forecast_ranking", "the forecast's factor in ranking"],
  ["forecast_appeals", "suggestions to eligible donors nearby, from the forecast"],
];
const percent = (value) =>
  value === null || value === undefined ? "—" : `${Math.round(value * 1000) / 10}%`;
const decimal = (value, digits = 2) =>
  value === null || value === undefined ? "—" : Number(value).toFixed(digits);

// The stock-out forecast (docs/PLANS/ML_system.md, A3, A4 and A6): the live model, the
// last scoring and daily runs (red when no scoring run has finished for 7 hours), the
// flags with their switches and the kill switch's reason, and the latest daily metrics.
// Shows a note until the forecast's migration has added the tables.
function ForecastCard({ model, scoreRuns, dailyRuns, flags, metrics }) {
  if (model.error || flags.error) {
    return (
      <p className="card-body text-sm text-[#666]">
        The forecast&apos;s tables aren&apos;t set up yet: apply its migrations (npm run
        db:migrate).
      </p>
    );
  }
  const live = model.data?.[0];
  const lastScore = scoreRuns.data?.find((run) => run.finished_at && !run.error) ?? null;
  const lastFailure = scoreRuns.data?.find((run) => run.error) ?? null;
  const lastDaily = dailyRuns.data?.[0] ?? null;
  const overdue = forecastOverdue(lastScore?.finished_at ?? null);
  const flagByName = new Map((flags.data ?? []).map((flag) => [flag.name, flag]));
  const latest48 = (metrics.data ?? []).find((row) => row.horizon_h === 48);
  return (
    <>
      <p className="card-body text-sm">
        {live
          ? `Model ${live.id} (${live.kind}), predicting ${live.evaluation?.threshold_units ?? 0} or fewer units, trained on data to ${live.trained_to}.`
          : "No live model yet: publish one with node scripts/setup-forecast.mjs --publish."}
        {lastScore &&
          ` Last scored ${formatDateTime(lastScore.as_of)}: ${lastScore.rows_scored ?? 0} cases, finished ${formatDateTime(lastScore.finished_at)}.`}
        {lastDaily &&
          ` Daily job ${lastDaily.error ? "failed" : "ran"} ${formatDateTime(lastDaily.started_at)}.`}
      </p>
      {live && overdue.isOverdue && (
        <p className="card-body notice notice-error">
          {overdue.hoursSince === null
            ? "No scoring run has finished yet."
            : `No scoring run has finished for ${overdue.hoursSince.toFixed(1)} hours, more than ${overdue.limitHours}.`}{" "}
          Check forecast_runs and the forecast-score cron job.
        </p>
      )}
      {lastFailure && (
        <p className="card-body text-xs text-[#a52121]">
          Last failed run, {formatDateTime(lastFailure.started_at)}: {lastFailure.error}
        </p>
      )}
      <ul>
        {FORECAST_FLAGS.map(([name, label]) => {
          const flag = flagByName.get(name);
          return (
            <li key={name} className="result-item text-sm flex items-center justify-between gap-3">
              <span>
                <span className="font-semibold">{flag?.is_enabled ? "On" : "Off"}</span>: {label}
                {flag?.disabled_reason && (
                  <span className="text-[#a52121]">
                    {" "}
                    · stopped by the kill switch: {flag.disabled_reason}
                  </span>
                )}
              </span>
              <FlagToggle name={name} label={label} isEnabled={Boolean(flag?.is_enabled)} />
            </li>
          );
        })}
      </ul>
      {latest48 ? (
        <div className="card-body text-sm">
          <p>
            Live check at 48 h, {latest48.day} ({latest48.cases} cases, {latest48.positives} fell
            low): PR-AUC {decimal(latest48.pr_auc, 3)}, predicted ÷ observed{" "}
            {decimal(latest48.calibration_ratio)}, false alerts per bank per week{" "}
            {decimal(latest48.false_alerts_per_bank_week)}, caught{" "}
            {percent(latest48.recall_at_cut_off)}. Cut-off from now on:{" "}
            {decimal(latest48.cut_off, 3)}.
          </p>
          {latest48.lift_by_group && (
            <p className="text-xs text-[#666] mt-1">
              Lift by group:{" "}
              {Object.entries(latest48.lift_by_group)
                .map(([group, entry]) => `${group} ${decimal(entry.lift, 1)}`)
                .join(" · ")}
            </p>
          )}
        </div>
      ) : (
        <p className="card-body text-xs text-[#666]">
          No live metrics yet: the daily job needs a full day of scores whose 72-hour windows have
          closed, about four days after scoring starts.
        </p>
      )}
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
    forecastModel,
    forecastScoreRuns,
    forecastDailyRuns,
    forecastFlags,
    forecastMetrics,
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
    supabase
      .from("model_versions")
      .select("id, kind, trained_to, evaluation")
      .eq("status", "live")
      .limit(1),
    supabase
      .from("forecast_runs")
      .select("as_of, started_at, finished_at, rows_scored, error")
      .eq("job", "score")
      .order("started_at", { ascending: false })
      .limit(10),
    supabase
      .from("forecast_runs")
      .select("started_at, finished_at, error")
      .eq("job", "daily")
      .order("started_at", { ascending: false })
      .limit(1),
    supabase.from("feature_flags").select("name, is_enabled, disabled_reason"),
    supabase
      .from("forecast_daily_metrics")
      .select(
        "day, horizon_h, cases, positives, pr_auc, calibration_ratio, cut_off, recall_at_cut_off, false_alerts_per_bank_week, lift_by_group",
      )
      .order("day", { ascending: false })
      .limit(3),
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
        <h2 className="card-title">Stock-out forecast (beta)</h2>
        <ForecastCard
          model={forecastModel}
          scoreRuns={forecastScoreRuns}
          dailyRuns={forecastDailyRuns}
          flags={forecastFlags}
          metrics={forecastMetrics}
        />
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
