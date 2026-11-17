"use client";
import { useState } from "react";
import {
  bloodGroupLabel,
  cardState,
  directionsUrl,
  distanceBandText,
  neededByText,
  urgencyLabel,
} from "@/lib/donorCards";
import { postCardAction, useDonorCards } from "../useDonorCards";

// The donor's open request cards (S31, S32). Opening a card marks it seen; accepting shows the
// centre's address, a map link, its phone number and the check-in code. Patient details are
// never shown.
export default function DonorRequestsCard() {
  const { cards, isLoaded, reload } = useDonorCards();
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState("");

  async function act(card, body) {
    setBusyId(card.requestId);
    setMessage("");
    const error = await postCardAction({ requestId: card.requestId, ...body }, reload);
    if (error) setMessage(error);
    setBusyId(null);
  }

  function toggle(card) {
    const isOpening = openId !== card.requestId;
    setOpenId(isOpening ? card.requestId : null);
    // Expanding is one of the three things that mark a card seen.
    if (isOpening && card.responseStatus === "notified") {
      postCardAction({ action: "seen", requestId: card.requestId }, async () => {});
    }
  }

  return (
    <div className="card mt-5">
      <h2 className="card-title">Blood requests for you</h2>
      <div className="card-body flex flex-col gap-3">
        <p className="text-xs text-[#666]">
          Blood centres near you may ask for your help. You only ever deal with the centre. Donors
          never contact patients or their families.
        </p>
        {message && (
          <p role="alert" className="text-sm text-[#d32f2f]">
            {message}
          </p>
        )}
        {!isLoaded && <p className="text-sm text-[#666]">Loading...</p>}
        {isLoaded && cards.length === 0 && (
          <p className="text-sm text-[#666]">No open requests right now.</p>
        )}
        {cards.map((card) => {
          const state = cardState(card);
          const isOpen = openId === card.requestId;
          const isBusy = busyId === card.requestId;
          const mapUrl = directionsUrl(card);
          return (
            <div key={card.requestId} className="border border-[#e0e0e0] rounded-md p-3">
              <button
                type="button"
                className="w-full text-left flex flex-wrap items-center gap-2"
                aria-expanded={isOpen}
                onClick={() => toggle(card)}
              >
                <span className="font-semibold">{bloodGroupLabel(card.bloodGroupCode)}</span>
                <span className={card.urgency === "critical" ? "badge badge-red" : "badge"}>
                  {urgencyLabel(card.urgency)}
                </span>
                {state === "accepted" && <span className="badge badge-green">Accepted</span>}
                <span className="text-sm text-[#444]">{card.centreName}</span>
              </button>
              <p className="text-xs text-[#666] mt-1">
                {distanceBandText(card.distanceBand)} · Needed by {neededByText(card.neededBy)}
              </p>

              {state === "waiting" && (
                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    className="btn btn-primary btn-small"
                    disabled={isBusy}
                    onClick={() => act(card, { action: "respond", accept: true })}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-small"
                    disabled={isBusy}
                    onClick={() => act(card, { action: "respond", accept: false })}
                  >
                    Decline
                  </button>
                </div>
              )}

              {state === "accepted" && (
                <div className="mt-3 text-sm flex flex-col gap-1">
                  <p className="font-semibold">{card.centreName}</p>
                  {card.centreAddress && <p>{card.centreAddress}</p>}
                  {mapUrl && (
                    <a
                      href={mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#d32f2f] font-semibold"
                    >
                      Directions in Google Maps
                    </a>
                  )}
                  {card.centrePhone && (
                    <p>
                      Phone:{" "}
                      <a href={`tel:${card.centrePhone}`} className="text-[#d32f2f]">
                        {card.centrePhone}
                      </a>
                    </p>
                  )}
                  {card.checkInCode && (
                    <p>
                      Check-in code:{" "}
                      <span className="font-mono font-semibold tracking-widest">
                        {card.checkInCode}
                      </span>{" "}
                      <span className="text-xs text-[#666]">
                        Give it at the centre when you arrive.
                      </span>
                    </p>
                  )}
                  {card.holdUntil && (
                    <p className="text-xs text-[#666]">
                      Your place is held until {neededByText(card.holdUntil)}.
                    </p>
                  )}
                  <div className="mt-2">
                    <button
                      type="button"
                      className="btn btn-outline btn-small"
                      disabled={isBusy}
                      onClick={() => act(card, { action: "cancel" })}
                    >
                      Can&apos;t come
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
