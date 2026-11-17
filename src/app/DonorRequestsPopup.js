"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  bloodGroupLabel,
  cardState,
  distanceBandText,
  neededByText,
  urgencyLabel,
} from "@/lib/donorCards";
import { postCardAction, useDonorCards } from "./useDonorCards";

const HIDDEN_KEY = "bloodlink.donorRequestsPopupHidden";

// Only a convenience: where storage is blocked the popup simply shows again.
function readHidden() {
  try {
    return window.sessionStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

// The open requests as a modal on page load (S31, S36). Opening it and "Not now" don't mark
// anything seen; accepting or declining does. It renders nothing, and fetches nothing, for
// anyone who isn't signed in.
export default function DonorRequestsPopup() {
  const { signedIn, cards, reload } = useDonorCards();
  const [hiddenChoice, setHiddenChoice] = useState(null); // null until the donor chooses
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState("");
  const [acceptedCentre, setAcceptedCentre] = useState("");
  const dialogRef = useRef(null);

  const waiting = cards.filter((card) => cardState(card) === "waiting");
  // The stored choice is read only once signed in, which is after hydration.
  const isHidden = hiddenChoice ?? (signedIn && readHidden());
  const isOpen = signedIn && !isHidden && (waiting.length > 0 || Boolean(acceptedCentre));

  function hide() {
    try {
      window.sessionStorage.setItem(HIDDEN_KEY, "1");
    } catch {
      // Not stored; the popup shows on the next page load.
    }
    setHiddenChoice(true);
  }

  useEffect(() => {
    if (!isOpen) return undefined;
    const previous = document.activeElement;
    dialogRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === "Escape") {
        hide();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll("a[href], button:not(:disabled)");
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [isOpen]);

  async function answer(card, accept) {
    setBusyId(card.requestId);
    setMessage("");
    const error = await postCardAction(
      { action: "respond", requestId: card.requestId, accept },
      reload,
    );
    if (error) setMessage(error);
    else if (accept) setAcceptedCentre(card.centreName);
    setBusyId(null);
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="donor-requests-title"
        tabIndex={-1}
        className="bg-white rounded-lg w-full max-w-[520px] max-h-[85vh] overflow-y-auto p-5 outline-none"
      >
        <h2 id="donor-requests-title" className="text-lg font-semibold">
          Blood requests for you
        </h2>
        <p className="text-xs text-[#666] mt-1">
          You only ever deal with the blood centre. Donors never contact patients or their families.
        </p>
        {message && (
          <p role="alert" className="text-sm text-[#d32f2f] mt-2">
            {message}
          </p>
        )}
        {acceptedCentre && (
          <p role="status" className="text-sm mt-3">
            Thank you. {acceptedCentre}&apos;s address, phone number and your check-in code are on
            your{" "}
            <Link href="/peer-to-peer" className="text-[#d32f2f] font-semibold" onClick={hide}>
              Peer to peer page
            </Link>
            .
          </p>
        )}
        <ul className="flex flex-col gap-3 mt-3">
          {waiting.map((card) => (
            <li key={card.requestId} className="border border-[#e0e0e0] rounded-md p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{bloodGroupLabel(card.bloodGroupCode)}</span>
                <span className={card.urgency === "critical" ? "badge badge-red" : "badge"}>
                  {urgencyLabel(card.urgency)}
                </span>
                <span className="text-sm text-[#444]">{card.centreName}</span>
              </div>
              <p className="text-xs text-[#666] mt-1">
                {distanceBandText(card.distanceBand)} · Needed by {neededByText(card.neededBy)}
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  disabled={busyId === card.requestId}
                  onClick={() => answer(card, true)}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-small"
                  disabled={busyId === card.requestId}
                  onClick={() => answer(card, false)}
                >
                  Decline
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex justify-end mt-4">
          <button type="button" className="btn btn-outline btn-small" onClick={hide}>
            {waiting.length > 0 ? "Not now" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
