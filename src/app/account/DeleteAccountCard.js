"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { createClient } from "@/lib/supabase/client";

// The person types DELETE before the button works, so one stray click can't do it.
const CONFIRM_WORD = "DELETE";

export default function DeleteAccountCard({ isAdmin }) {
  const router = useRouter();
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete(event) {
    event.preventDefault();
    setIsDeleting(true);
    setError("");
    try {
      await axios.delete("/api/account");
      // The response cleared the cookies; this tells the header, which reads the
      // browser's session, that nobody is signed in.
      await createClient().auth.signOut({ scope: "local" });
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err?.response?.data?.error || "Could not delete your account. Please try again.");
      setIsDeleting(false);
    }
  }

  function handleCancel() {
    setIsConfirming(false);
    setConfirmText("");
    setError("");
  }

  return (
    <div className="card mt-5">
      <h2 className="card-title">Delete your account</h2>
      <div className="card-body text-sm">
        <p className="text-[#666]">
          This deletes your account, your profile, your donor screening answers and any organization
          application you made, straight away. It can&apos;t be undone.
          {isAdmin && " If you are the only admin, make someone else an admin first."}
        </p>

        {!isConfirming ? (
          <button
            type="button"
            className="btn btn-outline mt-3"
            onClick={() => setIsConfirming(true)}
          >
            Delete my account
          </button>
        ) : (
          <form onSubmit={handleDelete} className="flex flex-col gap-3 mt-3">
            <div>
              <label className="label" htmlFor="confirmDelete">
                Type {CONFIRM_WORD} to confirm
              </label>
              <input
                id="confirmDelete"
                className="input"
                autoComplete="off"
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
              />
            </div>
            {error && <p className="notice notice-error">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-outline"
                onClick={handleCancel}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={confirmText !== CONFIRM_WORD || isDeleting}
              >
                {isDeleting ? "Deleting…" : "Delete for good"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
