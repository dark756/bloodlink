"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import axios from "axios";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  AREA_KINDS,
  CHANNELS,
  DEFAULT_SETTINGS,
  DONOR_NETWORK_NOTICE_POINTS,
  DONOR_NETWORK_NOTICE_VERSION,
  SELECTABLE_CHANNELS,
  roundCell,
} from "@/lib/donorNetwork";

// Leaflet touches `window` on import, so the map loads only in the browser.
const AreaMap = dynamic(() => import("./AreaMap"), {
  ssr: false,
  loading: () => <p className="text-sm text-[#666]">Loading the map...</p>,
});

const AREA_LABELS = { home: "Home", work: "Work" };
const CHANNEL_LABELS = { in_app: "In-app", push: "Push", email: "Email", sms: "SMS" };
const STALE_ANSWERS_DAYS = 90;
const WEEK_MS = 7 * 86_400_000;

const errorMessage = (err, fallback) => err?.response?.data?.error || fallback;

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-1" checked={checked} onChange={onChange} />
      <span>
        {label}
        {hint && <span className="block text-xs text-[#666]">{hint}</span>}
      </span>
    </label>
  );
}

// Why the person is or isn't in the network, in plain words. Informational: the blood
// centre's medical officer makes the final call.
function StatusLines({ status, loadedAt }) {
  if (!status) {
    return <p className="text-sm text-[#666]">Your status is being worked out. Check back soon.</p>;
  }
  const hasWindow = Boolean(status.eligibleFrom && status.eligibleUntil);
  const confirmedAt = status.screeningConfirmedAt ? new Date(status.screeningConfirmedAt) : null;
  const isStale =
    !confirmedAt || loadedAt - confirmedAt.getTime() > STALE_ANSWERS_DAYS * 86_400_000;
  return (
    <div className="text-sm flex flex-col gap-1">
      <p>
        {status.isInNetwork ? (
          <span className="badge badge-green">In the network</span>
        ) : (
          <span className="badge">Not in the network</span>
        )}
      </p>
      {hasWindow ? (
        <p className="text-[#666]">
          You may be able to donate from {formatDate(status.eligibleFrom)} to{" "}
          {formatDate(status.eligibleUntil)}.
        </p>
      ) : (
        <p className="text-[#666]">
          Not eligible right now, going by your answers. The blood centre decides in the end.
        </p>
      )}
      {status.needsStaffCheck && (
        <p className="text-[#666]">
          You take medication, so the blood centre&apos;s staff will check before you donate.
        </p>
      )}
      {isStale && (
        <p className="text-[#666]">
          Your screening answers are older than {STALE_ANSWERS_DAYS} days.{" "}
          <Link href="/set-details" className="text-[#d32f2f] font-semibold">
            Review them
          </Link>
        </p>
      )}
    </div>
  );
}

export default function DonorNetworkCard() {
  const [data, setData] = useState(undefined); // undefined = loading
  const [loadedAt, setLoadedAt] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [reloadCount, setReloadCount] = useState(0);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [areas, setAreas] = useState([]);
  const [activeKind, setActiveKind] = useState("home");
  const [isBusy, setIsBusy] = useState(false);
  const [isConfirmingWithdraw, setIsConfirmingWithdraw] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let isCancelled = false;
    axios
      .get("/api/donor-network")
      .then(({ data: loaded }) => {
        if (isCancelled) return;
        setData(loaded);
        setLoadedAt(Date.now());
        setSettings(loaded.settings ?? DEFAULT_SETTINGS);
        setAreas(loaded.areas ?? []);
        setLoadError("");
      })
      .catch((err) => {
        if (!isCancelled) {
          setData(null);
          setLoadError(errorMessage(err, "Could not load the donor network."));
        }
      });
    return () => {
      isCancelled = true;
    };
  }, [reloadCount]);

  async function post(payload, doneMessage) {
    setIsBusy(true);
    setError("");
    setMessage("");
    try {
      await axios.post("/api/donor-network", payload);
      setMessage(doneMessage);
      setIsConfirmingWithdraw(false);
      setReloadCount((count) => count + 1);
    } catch (err) {
      setError(errorMessage(err, "Something went wrong. Please try again."));
    } finally {
      setIsBusy(false);
    }
  }

  const update = (changes) => setSettings((current) => ({ ...current, ...changes }));

  // The browser rounds to about 1 km before anything is sent; the server rounds again.
  function handlePick({ latitude, longitude }) {
    const area = {
      kind: activeKind,
      latitude: roundCell(latitude),
      longitude: roundCell(longitude),
    };
    setAreas((current) => [...current.filter((item) => item.kind !== activeKind), area]);
  }

  function toggleChannel(channel) {
    const has = settings.channels.includes(channel);
    const next = has
      ? settings.channels.filter((item) => item !== channel)
      : [...settings.channels, channel];
    update({ channels: next });
  }

  let body;
  if (data === undefined) {
    body = <p className="text-sm text-[#666]">Loading...</p>;
  } else if (loadError) {
    body = <p className="notice notice-error">{loadError}</p>;
  } else if (data.available === false) {
    body = (
      <p className="text-sm text-[#666]">
        The donor network isn&apos;t open yet. It will appear here when it is.
      </p>
    );
  } else if (!data.consent || data.consent.noticeVersion !== DONOR_NETWORK_NOTICE_VERSION) {
    const isAskingAgain = Boolean(data.consent);
    body = (
      <>
        {isAskingAgain && (
          <p className="notice notice-warn">
            The notice has changed since you joined on {formatDate(data.consent.givenAt)}. Please
            read it and agree again to stay in the network.
          </p>
        )}
        <p className="text-sm mt-2">
          Join the donor network so that, later, a licensed blood centre near you can ask for your
          help.
        </p>
        <ul className="text-sm text-[#444] list-disc ml-5 mt-2 flex flex-col gap-1">
          {DONOR_NETWORK_NOTICE_POINTS.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <p className="text-xs text-[#666] mt-2">
          Notice of {formatDate(DONOR_NETWORK_NOTICE_VERSION)}. See also the{" "}
          <Link href="/privacy" className="text-[#d32f2f] font-semibold">
            privacy note
          </Link>
          .
        </p>
        <button
          type="button"
          className="btn btn-primary mt-3"
          disabled={isBusy}
          onClick={() =>
            post(
              { action: "join", noticeVersion: DONOR_NETWORK_NOTICE_VERSION },
              "You are in the donor network.",
            )
          }
        >
          {isBusy ? "Joining..." : isAskingAgain ? "Agree and stay" : "Join the donor network"}
        </button>
      </>
    );
  } else {
    const isSnoozed = settings.snoozedUntil && Date.parse(settings.snoozedUntil) > loadedAt;
    body = (
      <>
        <StatusLines status={data.status} loadedAt={loadedAt} />

        <h3 className="font-semibold text-[#222] mt-5 mb-1">Your areas</h3>
        <p className="text-xs text-[#666] mb-2">
          Pick up to two places, such as home and work. Each is rounded to about 1 km in your
          browser before it is sent, never your address.
        </p>
        <div className="flex flex-wrap gap-2 mb-2">
          {AREA_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className={`btn btn-small ${activeKind === kind ? "btn-primary" : "btn-outline"}`}
              onClick={() => setActiveKind(kind)}
            >
              Set {AREA_LABELS[kind].toLowerCase()}
            </button>
          ))}
        </div>
        <AreaMap areas={areas} onPick={handlePick} />
        <ul className="text-xs text-[#666] mt-2">
          {AREA_KINDS.map((kind) => {
            const area = areas.find((item) => item.kind === kind);
            return (
              <li key={kind}>
                {AREA_LABELS[kind]}:{" "}
                {area ? (
                  <>
                    near {area.latitude.toFixed(2)}, {area.longitude.toFixed(2)}{" "}
                    <button
                      type="button"
                      className="text-[#d32f2f] font-semibold"
                      onClick={() => setAreas((current) => current.filter((i) => i.kind !== kind))}
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  "not set"
                )}
              </li>
            );
          })}
        </ul>

        <h3 className="font-semibold text-[#222] mt-5 mb-1">Availability</h3>
        <div className="flex flex-col gap-2">
          <Toggle
            label="I am available to be asked"
            checked={settings.isAvailable}
            onChange={(event) => update({ isAvailable: event.target.checked })}
          />
          <div className="text-sm flex flex-wrap items-center gap-2">
            {isSnoozed ? (
              <>
                <span>Snoozed until {formatDateTime(settings.snoozedUntil)}.</span>
                <button
                  type="button"
                  className="btn btn-outline btn-small"
                  onClick={() => update({ snoozedUntil: null })}
                >
                  End snooze
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-outline btn-small"
                onClick={() =>
                  update({ snoozedUntil: new Date(Date.now() + WEEK_MS).toISOString() })
                }
              >
                Snooze for a week
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="quiet-start">
                Quiet hours from
              </label>
              <input
                id="quiet-start"
                type="time"
                className="input"
                value={settings.quietStart}
                onChange={(event) => update({ quietStart: event.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="quiet-end">
                to
              </label>
              <input
                id="quiet-end"
                type="time"
                className="input"
                value={settings.quietEnd}
                onChange={(event) => update({ quietEnd: event.target.value })}
              />
            </div>
          </div>
          <Toggle
            label="A critical request may reach me in quiet hours"
            checked={settings.criticalOverridesQuiet}
            onChange={(event) => update({ criticalOverridesQuiet: event.target.checked })}
          />
          <Toggle
            label="A critical request may reach me inside my donation gap"
            hint="Only for being asked. The blood centre's medical officer makes the final call."
            checked={settings.criticalOverridesGap}
            onChange={(event) => update({ criticalOverridesGap: event.target.checked })}
          />
          <div>
            <label className="label" htmlFor="max-requests">
              Most requests a week
            </label>
            <select
              id="max-requests"
              className="select"
              value={settings.maxRequestsPerWeek}
              onChange={(event) => update({ maxRequestsPerWeek: Number(event.target.value) })}
            >
              {[1, 2, 3, 4, 5, 6, 7].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </div>
          <Toggle
            label="I am willing to give platelets or plasma (apheresis)"
            checked={settings.apheresisWilling}
            onChange={(event) => update({ apheresisWilling: event.target.checked })}
          />
        </div>

        <h3 className="font-semibold text-[#222] mt-5 mb-1">How to reach you</h3>
        <div className="flex flex-wrap gap-4">
          {CHANNELS.map((channel) =>
            SELECTABLE_CHANNELS.includes(channel) ? (
              <Toggle
                key={channel}
                label={CHANNEL_LABELS[channel]}
                checked={settings.channels.includes(channel)}
                onChange={() => toggleChannel(channel)}
              />
            ) : (
              <span key={channel} className="text-sm text-[#999]">
                {CHANNEL_LABELS[channel]} (later)
              </span>
            ),
          )}
        </div>

        <button
          type="button"
          className="btn btn-primary mt-5"
          disabled={isBusy}
          onClick={() => post({ action: "save", settings, areas }, "Saved.")}
        >
          {isBusy ? "Saving..." : "Save"}
        </button>

        <div className="mt-5 border-t border-[#e0e0e0] pt-4">
          {isConfirmingWithdraw ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                Withdrawing deletes your areas and settings at once. You can join again later.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  disabled={isBusy}
                  onClick={() => post({ action: "withdraw" }, "You have left the donor network.")}
                >
                  {isBusy ? "Withdrawing..." : "Yes, withdraw"}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-small"
                  disabled={isBusy}
                  onClick={() => setIsConfirmingWithdraw(false)}
                >
                  Keep me in
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-outline btn-small"
              onClick={() => setIsConfirmingWithdraw(true)}
            >
              Withdraw from the donor network
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="card mt-5">
      <h2 className="card-title">Donor network (beta)</h2>
      <div className="card-body">
        {body}
        {error && <p className="notice notice-error mt-3">{error}</p>}
        {message && !error && <p className="text-sm text-[#2e7d32] mt-3">{message}</p>}
      </div>
    </div>
  );
}
