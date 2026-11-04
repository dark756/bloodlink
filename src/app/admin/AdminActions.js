"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";

// Shared state for an admin button: posts to an admin API route, then refreshes the page.
function useAdminAction() {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");

  async function runAction(url, body) {
    setIsBusy(true);
    setError("");
    try {
      await axios.post(url, body);
      router.refresh();
    } catch (err) {
      setError(err?.response?.data?.error || "The action failed. Please try again.");
    } finally {
      setIsBusy(false);
    }
  }
  return { isBusy, error, runAction };
}

// Buttons offered for each application status: [decision, button label, button class].
function decisionsFor(status) {
  if (status === "pending") {
    return [
      ["approved", "Approve", "btn-primary"],
      ["rejected", "Reject", "btn-outline"],
    ];
  }
  if (status === "approved") return [["suspended", "Suspend", "btn-outline"]];
  return [["approved", "Approve", "btn-outline"]];
}

// Approve / reject / suspend / reinstate an organization application.
export function OrganizationActions({ organizationId, status }) {
  const { isBusy, error, runAction } = useAdminAction();
  const [note, setNote] = useState("");

  const submitDecision = (decision) =>
    runAction("/api/admin/organizations/review", {
      organizationId,
      decision,
      note: note.trim() || null,
    });

  return (
    <div className="mt-3">
      <input
        className="input"
        placeholder="Note to the applicant (optional)"
        value={note}
        maxLength={500}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="flex gap-2 mt-2">
        {decisionsFor(status).map(([decision, label, buttonClass]) => (
          <button
            key={decision}
            className={`btn btn-small ${buttonClass}`}
            disabled={isBusy}
            onClick={() => submitDecision(decision)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="notice notice-error mt-2">{error}</p>}
    </div>
  );
}

// Turn one of the forecast's flags on or off (set_feature_flag, audited).
export function FlagToggle({ name, label, isEnabled }) {
  const { isBusy, error, runAction } = useAdminAction();
  const action = isEnabled ? "Turn off" : "Turn on";
  function handleClick() {
    if (window.confirm(`${action} ${label}?`)) {
      runAction("/api/admin/flags", { name, isEnabled: !isEnabled });
    }
  }
  return (
    <div>
      <button
        className={`btn btn-small ${isEnabled ? "btn-outline" : "btn-primary"}`}
        disabled={isBusy}
        onClick={handleClick}
      >
        {action}
      </button>
      {error && <p className="text-xs text-[#a52121] mt-1">{error}</p>}
    </div>
  );
}

// Mark a bank's group at risk for 24, 48 or 72 hours (create_admin_event, audited).
// It shows in search and reaches eligible donors nearby while it is active.
export function StockEventForm({ components, groups }) {
  const { isBusy, error, runAction } = useAdminAction();
  const [form, setForm] = useState({
    hospitalCode: "",
    componentId: "12",
    bloodGroupId: "16",
    windowHours: 48,
    reason: "",
  });
  const update = (name) => (event) =>
    setForm({
      ...form,
      [name]: name === "windowHours" ? Number(event.target.value) : event.target.value,
    });

  function handleSubmit(event) {
    event.preventDefault();
    const group = groups.find((entry) => entry.code === form.bloodGroupId)?.name;
    if (
      window.confirm(
        `Flag ${group} at bank ${form.hospitalCode} for ${form.windowHours} hours? Everyone searching sees it, and eligible donors nearby are asked to help.`,
      )
    ) {
      runAction("/api/admin/events", { action: "create", ...form });
    }
  }

  return (
    <form className="card-body grid gap-2 sm:grid-cols-2" onSubmit={handleSubmit}>
      <input
        className="input"
        placeholder="Bank's eRaktKosh code"
        inputMode="numeric"
        value={form.hospitalCode}
        onChange={update("hospitalCode")}
        required
      />
      <select className="input" value={form.componentId} onChange={update("componentId")}>
        {components.map((component) => (
          <option key={component.code} value={component.code}>
            {component.name}
          </option>
        ))}
      </select>
      <select className="input" value={form.bloodGroupId} onChange={update("bloodGroupId")}>
        {groups.map((group) => (
          <option key={group.code} value={group.code}>
            {group.name}
          </option>
        ))}
      </select>
      <select className="input" value={form.windowHours} onChange={update("windowHours")}>
        {[24, 48, 72].map((hours) => (
          <option key={hours} value={hours}>
            For {hours} hours
          </option>
        ))}
      </select>
      <input
        className="input sm:col-span-2"
        placeholder="Reason, shown to everyone (10 to 200 characters)"
        minLength={10}
        maxLength={200}
        value={form.reason}
        onChange={update("reason")}
        required
      />
      <div className="sm:col-span-2">
        <button className="btn btn-primary btn-small" disabled={isBusy} type="submit">
          Flag this bank
        </button>
        {error && <p className="notice notice-error mt-2">{error}</p>}
      </div>
    </form>
  );
}

// End an active event now (end_admin_event, audited).
export function EndEventButton({ id }) {
  const { isBusy, error, runAction } = useAdminAction();
  function handleClick() {
    if (window.confirm("End this event now? Its mark and suggestions stop at once.")) {
      runAction("/api/admin/events", { action: "end", id });
    }
  }
  return (
    <div>
      <button className="btn btn-outline btn-small" disabled={isBusy} onClick={handleClick}>
        End now
      </button>
      {error && <p className="text-xs text-[#a52121] mt-1">{error}</p>}
    </div>
  );
}

// Grant or remove the admin role.
export function RoleActions({ userId, role, isSelf }) {
  const { isBusy, error, runAction } = useAdminAction();
  if (role === "hospital" || role === "blood_bank") {
    return <span className="text-xs text-[#666]">Set by verification</span>;
  }
  const nextRole = role === "admin" ? "user" : "admin";
  const label =
    role === "admin" ? (isSelf ? "Remove my admin role" : "Remove admin") : "Make admin";

  function handleClick() {
    if (window.confirm(`${label}?`)) runAction("/api/admin/users/role", { userId, role: nextRole });
  }

  return (
    <div>
      <button className="btn btn-outline btn-small" disabled={isBusy} onClick={handleClick}>
        {label}
      </button>
      {error && <p className="text-xs text-[#a52121] mt-1">{error}</p>}
    </div>
  );
}
