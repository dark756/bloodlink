import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";

// One line of context for an audit entry, from the details the database function stored.
function describeAuditEntry(entry) {
  const details = entry.details ?? {};
  if (entry.target_type === "organization") {
    return `${details.name ?? "Organization"} (${details.kind ?? "?"}), was ${details.previous_status ?? "?"}`;
  }
  if (entry.target_type === "user") return `${details.from ?? "?"} → ${details.to ?? "?"}`;
  return "";
}

export default async function AdminAuditPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_log")
    .select(
      "id, action, target_type, target_id, details, created_at, actor:profiles!audit_log_actor_id_fkey(email)",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div className="card">
      <h2 className="card-title">Audit log (latest 200)</h2>
      {error ? (
        <p className="card-body notice notice-error">
          Could not load the audit log: {error.message}
        </p>
      ) : data.length === 0 ? (
        <p className="card-body text-sm text-[#666]">No entries yet.</p>
      ) : (
        <ul>
          {data.map((entry) => (
            <li key={entry.id} className="result-item text-sm">
              <p>
                <span className="font-semibold">{entry.action}</span>{" "}
                <span className="text-[#666]">{describeAuditEntry(entry)}</span>
              </p>
              {entry.details?.note && <p className="text-xs mt-1">Note: {entry.details.note}</p>}
              <p className="text-xs text-[#666] mt-1">
                {entry.actor?.email ?? "system"} · {formatDateTime(entry.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
