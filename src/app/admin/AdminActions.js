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
