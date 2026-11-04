import { createClient } from "@/lib/supabase/server";
import { BLOOD_GROUPS, COMPONENTS, getBloodGroupName, getComponentName } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { EndEventButton, FlagToggle, StockEventForm } from "../AdminActions";

// Stock-out events an admin makes (docs/PLANS/ML_system.md, Part C, in the closed
// beta). An event is real: while it is active, search marks the bank "flagged by
// bloodLink's team" and eligible donors nearby see it in their suggestions. It ends by
// itself after its window, or at once with "End now". Everything is audited.

const isActive = (event, now) => !event.ended_at && new Date(event.ends_at) > now;

export default async function AdminEventsPage() {
  const supabase = await createClient();
  const [{ data: events, error }, { data: flags }] = await Promise.all([
    supabase
      .from("admin_stock_events")
      .select(
        "id, hospital_code, component_id, blood_group_code, window_hours, reason, created_at, ends_at, ended_at, creator:profiles!admin_stock_events_created_by_fkey(email)",
      )
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("feature_flags").select("name, is_enabled").eq("name", "admin_events"),
  ]);
  const codes = [...new Set((events ?? []).map((event) => event.hospital_code))];
  const { data: banks } = codes.length
    ? await supabase.from("blood_banks").select("hospital_code, name").in("hospital_code", codes)
    : { data: [] };
  const bankNames = new Map((banks ?? []).map((bank) => [bank.hospital_code, bank.name]));
  const isOn = flags?.[0]?.is_enabled === true;
  const now = new Date();

  return (
    <>
      <div className="card">
        <h2 className="card-title">Flag a bank that may run low</h2>
        <div className="card-body text-sm flex items-center justify-between gap-3">
          <span>
            Events are <strong>{isOn ? "shown" : "hidden"}</strong>: in search, and to eligible
            donors nearby.
          </span>
          <FlagToggle name="admin_events" label="stock-out events" isEnabled={isOn} />
        </div>
        <StockEventForm components={COMPONENTS} groups={BLOOD_GROUPS} />
        <p className="card-body text-xs text-[#666]">
          An event is real: everyone searching that bank and group sees &quot;flagged by
          bloodLink&apos;s team&quot; with the reason, and donors of that group within 15 km who are
          eligible today see it in their suggestions. It ends by itself after the window you choose.
        </p>
      </div>

      <div className="card mt-5">
        <h2 className="card-title">Events (latest 50)</h2>
        {error ? (
          <p className="card-body notice notice-error">Could not load events: {error.message}</p>
        ) : events.length === 0 ? (
          <p className="card-body text-sm text-[#666]">No events yet.</p>
        ) : (
          <ul>
            {events.map((event) => (
              <li
                key={event.id}
                className="result-item text-sm flex items-start justify-between gap-3"
              >
                <div>
                  <p className="font-semibold">
                    {getBloodGroupName(event.blood_group_code) ?? event.blood_group_code}{" "}
                    {getComponentName(event.component_id) ?? event.component_id} at{" "}
                    {bankNames.get(event.hospital_code) ?? "bank"} ({event.hospital_code})
                  </p>
                  <p className="text-[#666]">{event.reason}</p>
                  <p className="text-xs text-[#666] mt-1">
                    {isActive(event, now)
                      ? `Active until ${formatDateTime(event.ends_at)}`
                      : event.ended_at
                        ? `Ended ${formatDateTime(event.ended_at)}`
                        : `Ran out ${formatDateTime(event.ends_at)}`}{" "}
                    · {event.window_hours} h · by {event.creator?.email ?? "a deleted account"} ·{" "}
                    {formatDateTime(event.created_at)}
                  </p>
                </div>
                {isActive(event, now) && <EndEventButton id={event.id} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
