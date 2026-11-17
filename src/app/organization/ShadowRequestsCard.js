"use client";
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { BLOOD_GROUPS, COMPONENTS, getBloodGroupName, getComponentName } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import {
  PATIENT_REFERENCE_MAX,
  DONATION_KIND_LABELS,
  REQUEST_KINDS,
  REQUEST_KIND_LABELS,
  UNITS_MAX,
  UNITS_MIN,
  URGENCIES,
  URGENCY_LABELS,
  donationKindsFor,
} from "@/lib/donorRequests";

const SHADOW_NOTICE = "Shadow mode: no donor is told";
const LIVE_NOTICE = "Live: donors see this when they open the site";
const DONOR_STATUS_LABELS = { accepted: "Accepted, not yet arrived", arrived: "Arrived" };
const BAND_LABELS = ["to 5 km", "to 10 km", "to 15 km", "to 25 km", "beyond"];
const STATUS_LABELS = {
  open: "Open",
  covered: "Covered",
  fulfilled: "Fulfilled",
  partly_fulfilled: "Partly fulfilled",
  expired: "Expired",
  cancelled: "Cancelled",
};
const OPEN_STATUSES = ["open", "covered"];

const errorMessage = (err, fallback) => err?.response?.data?.error || fallback;

const emptyForm = (organization) => ({
  kind: "shortfall",
  anchorHospitalCode: organization?.kind === "blood_bank" ? (organization.eraktkoshCode ?? "") : "",
  bloodGroupCode: BLOOD_GROUPS[0].code,
  componentCode: COMPONENTS.find((component) => component.shortName === "PRBC")?.code ?? "",
  unitsNeeded: "1",
  urgency: "urgent",
  neededBy: "",
  allowCompatible: false,
  patientReference: "",
});

const formatNumber = (value, digits = 0) =>
  Number.isFinite(Number(value)) && value !== null ? Number(value).toFixed(digits) : "-";

// The distance bands arrive as a list of counts, or as an object keyed by band.
function bandText(bands) {
  if (!bands) return null;
  const counts = Array.isArray(bands) ? bands : Object.values(bands);
  return counts.map((count, index) => `${BAND_LABELS[index] ?? "more"}: ${count}`).join(" · ");
}

function filterText(filterCounts) {
  if (!filterCounts || typeof filterCounts !== "object") return null;
  const entries = Object.entries(filterCounts).filter(([, count]) => Number(count) > 0);
  if (entries.length === 0) return "No donor removed by a filter";
  return entries.map(([filter, count]) => `${filter.replaceAll("_", " ")}: ${count}`).join(" · ");
}

function WaveLine({ wave }) {
  const bands = bandText(wave.distanceBands);
  const filters = filterText(wave.filterCounts);
  return (
    <li className="result-item text-sm">
      <span className="font-semibold">Wave {wave.wave}</span>
      <span className="text-[#666]">
        {" "}
        · ring {wave.ringKm} km · {wave.candidates} candidates · would ask {wave.k} (acceptance{" "}
        {formatNumber(Number(wave.pAccept) * 100)}%) · {wave.exactCount} exact group
        {wave.compatibleCount > 0 && `, ${wave.compatibleCount} compatible`}
      </span>
      <span className="block text-xs text-[#666] mt-1">
        Score {formatNumber(wave.scoreMin, 2)} to {formatNumber(wave.scoreMax, 2)}, median{" "}
        {formatNumber(wave.scoreMedian, 2)}
        {bands && ` · ${bands}`}
      </span>
      {filters && <span className="block text-xs text-[#666]">{filters}</span>}
    </li>
  );
}

function DonorRow({ donor, kinds, onConfirm, onDefer, isBusy }) {
  const [kind, setKind] = useState(kinds[0] ?? "");
  return (
    <li className="result-item text-sm">
      <span className="font-semibold">{donor.name}</span>
      <span className="badge ml-2">{DONOR_STATUS_LABELS[donor.status] ?? donor.status}</span>
      <span className="block text-xs text-[#666] mt-1">
        {donor.phone ? `Phone ${donor.phone}` : "Phone not shared."}
        {donor.checkInCode && ` · check-in code ${donor.checkInCode}`}
        {donor.holdUntil && ` · held until ${formatDateTime(donor.holdUntil)}`}
      </span>
      <span className="flex flex-wrap items-center gap-2 mt-2">
        {kinds.length > 1 && (
          <select
            className="select"
            aria-label="Kind of donation"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            {kinds.map((option) => (
              <option key={option} value={option}>
                {DONATION_KIND_LABELS[option]}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="btn btn-primary btn-small"
          disabled={isBusy || kind === ""}
          onClick={() => onConfirm(donor.responseId, kind)}
        >
          Confirm donation
        </button>
        <button
          type="button"
          className="btn btn-outline btn-small"
          disabled={isBusy}
          onClick={() => onDefer(donor.responseId)}
        >
          Defer
        </button>
      </span>
    </li>
  );
}

function RequestCard({ item, onCancel, onConfirm, onDefer, isBusy }) {
  const isOpen = OPEN_STATUSES.includes(item.status);
  const isLive = item.mode === "live";
  const kinds = donationKindsFor(item.kind);
  const [donors, setDonors] = useState(null); // null = not opened yet
  const [isLoadingDonors, setIsLoadingDonors] = useState(false);
  const [donorsError, setDonorsError] = useState("");

  // Listing the donors logs a contact reveal, so it runs only when staff ask for it.
  async function loadDonors() {
    setIsLoadingDonors(true);
    setDonorsError("");
    try {
      const { data: body } = await axios.post("/api/requests", { action: "donors", id: item.id });
      setDonors(body.donors);
    } catch (err) {
      setDonorsError(errorMessage(err, "Could not load the donors. Please try again."));
    } finally {
      setIsLoadingDonors(false);
    }
  }

  return (
    <div className="card mt-4">
      <h3 className="card-title flex items-center justify-between gap-2">
        <span>
          {item.unitsNeeded} × {getBloodGroupName(item.bloodGroupCode) ?? item.bloodGroupCode}{" "}
          {getComponentName(item.componentCode) ?? ""}
        </span>
        <span className="badge">{STATUS_LABELS[item.status] ?? item.status}</span>
      </h3>
      <div className="card-body text-sm">
        <p className="text-[#666]">
          {REQUEST_KIND_LABELS[item.kind] ?? item.kind} · {URGENCY_LABELS[item.urgency]} · needed by{" "}
          {formatDateTime(item.neededBy)} · anchored at code {item.anchorHospitalCode}
          {item.area && ` · ${item.area} area`}
        </p>
        <p className="text-xs text-[#666] mt-1">
          Raised {formatDateTime(item.createdAt)}
          {item.patientReference && ` · reference ${item.patientReference}`}
          {item.closeReason && ` · ${item.closeReason}`}
        </p>
        <p className={`notice mt-3 ${isLive ? "" : "notice-warn"}`}>
          {isLive ? LIVE_NOTICE : SHADOW_NOTICE}
        </p>
        {isLive && isOpen && (
          <div className="mt-3">
            <p className="font-semibold">Donors who accepted</p>
            {donors === null ? (
              <>
                <p className="text-xs text-[#666] mt-1">
                  Opening the list is logged as a contact reveal.
                </p>
                <button
                  type="button"
                  className="btn btn-outline btn-small mt-2"
                  disabled={isBusy || isLoadingDonors}
                  onClick={loadDonors}
                >
                  {isLoadingDonors ? "Loading..." : "Show donors who accepted"}
                </button>
                {donorsError && <p className="notice notice-error mt-2">{donorsError}</p>}
              </>
            ) : donors.length === 0 ? (
              <p className="text-xs text-[#666] mt-1">No donor has accepted yet.</p>
            ) : (
              <ul className="mt-1">
                {donors.map((donor) => (
                  <DonorRow
                    key={donor.responseId}
                    donor={donor}
                    kinds={kinds}
                    onConfirm={async (...args) => {
                      await onConfirm(...args);
                      await loadDonors();
                    }}
                    onDefer={async (...args) => {
                      await onDefer(...args);
                      await loadDonors();
                    }}
                    isBusy={isBusy}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
        {item.waves.length === 0 ? (
          <p className="text-xs text-[#666] mt-3">
            {isOpen && item.nextWaveAt
              ? `The first wave runs ${formatDateTime(item.nextWaveAt)}.`
              : "No wave has run."}
          </p>
        ) : (
          <ul className="mt-3">
            {item.waves.map((wave) => (
              <WaveLine key={wave.wave} wave={wave} />
            ))}
          </ul>
        )}
        {isOpen && (
          <button
            type="button"
            className="btn btn-outline btn-small mt-3"
            disabled={isBusy}
            onClick={() => onCancel(item.id)}
          >
            Cancel this request
          </button>
        )}
      </div>
    </div>
  );
}

// Raises requests and shows each one's mode and waves, for an approved organization. A shadow
// request records its asks and tells nobody; a live one shows donors a card, and lists the
// donors who accepted with Confirm donation and Defer.
export default function ShadowRequestsCard() {
  const [data, setData] = useState(undefined); // undefined = loading
  const [form, setForm] = useState(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const { data: body } = await axios.get("/api/requests");
    setData(body);
    setForm((current) => current ?? emptyForm(body.organization));
  }, []);

  useEffect(() => {
    let isCancelled = false;
    axios
      .get("/api/requests")
      .then(({ data: body }) => {
        if (isCancelled) return;
        setData(body);
        setForm(emptyForm(body.organization));
      })
      .catch(() => {
        if (!isCancelled) setData({ available: false });
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  if (!data || !data.available || !data.organization || !form) return null;
  const { organization, requests } = data;
  const isBloodBank = organization.kind === "blood_bank";
  const handleChange = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    setIsBusy(true);
    setError("");
    setMessage("");
    try {
      await axios.post("/api/requests", {
        action: "create",
        ...form,
        unitsNeeded: Number(form.unitsNeeded),
        neededBy: form.neededBy ? new Date(form.neededBy).toISOString() : "",
        allowCompatible: isBloodBank && form.allowCompatible,
        patientReference: form.patientReference.trim() === "" ? null : form.patientReference,
      });
      setMessage("Request raised.");
      setForm(emptyForm(organization));
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not raise the request. Please try again."));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCancel(id) {
    const reason = window.prompt("Why is this request being cancelled?");
    if (!reason || reason.trim() === "") return;
    setIsBusy(true);
    setError("");
    setMessage("");
    try {
      await axios.post("/api/requests", { action: "cancel", id, reason: reason.trim() });
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not cancel the request. Please try again."));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleConfirm(responseId, kind) {
    setIsBusy(true);
    setError("");
    setMessage("");
    try {
      await axios.post("/api/requests", { action: "confirm_donation", responseId, kind });
      setMessage("Donation confirmed.");
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not confirm the donation. Please try again."));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDefer(responseId) {
    const reason = window.prompt("Why is this donor deferred?");
    if (!reason || reason.trim() === "") return;
    setIsBusy(true);
    setError("");
    setMessage("");
    try {
      await axios.post("/api/requests", { action: "defer", responseId, reason: reason.trim() });
      setMessage("Donor deferred.");
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not defer the donor. Please try again."));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="mt-8">
      <h2 className="page-title text-xl">Requests</h2>
      <p className="page-subtitle">
        Raise a request and follow each wave. A shadow request tells no donor; a live one shows
        donors a card when they open the site.
      </p>

      {error && <p className="notice notice-error mt-4">{error}</p>}
      {message && <p className="notice mt-4">{message}</p>}

      <form onSubmit={handleSubmit} className="card card-body mt-4 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="request-kind">
              Kind
            </label>
            <select
              id="request-kind"
              className="select"
              value={form.kind}
              onChange={handleChange("kind")}
            >
              {REQUEST_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {REQUEST_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="request-urgency">
              Urgency
            </label>
            <select
              id="request-urgency"
              className="select"
              value={form.urgency}
              onChange={handleChange("urgency")}
            >
              {URGENCIES.map((urgency) => (
                <option key={urgency} value={urgency}>
                  {URGENCY_LABELS[urgency]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="request-anchor">
            Blood bank&apos;s eRaktKosh code
          </label>
          <input
            id="request-anchor"
            className="input"
            inputMode="numeric"
            value={form.anchorHospitalCode}
            onChange={handleChange("anchorHospitalCode")}
            readOnly={isBloodBank && Boolean(organization.eraktkoshCode)}
            required
          />
          <p className="text-xs text-[#666] mt-1">
            {isBloodBank
              ? "Your own code. The request is anchored at your blood bank."
              : "The licensed blood bank that will screen and collect."}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="request-group">
              Blood group
            </label>
            <select
              id="request-group"
              className="select"
              value={form.bloodGroupCode}
              onChange={handleChange("bloodGroupCode")}
            >
              {BLOOD_GROUPS.map((group) => (
                <option key={group.code} value={group.code}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="request-component">
              Component
            </label>
            <select
              id="request-component"
              className="select"
              value={form.componentCode}
              onChange={handleChange("componentCode")}
            >
              {COMPONENTS.map((component) => (
                <option key={component.code} value={component.code}>
                  {component.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="request-units">
              Units needed
            </label>
            <input
              id="request-units"
              className="input"
              type="number"
              min={UNITS_MIN}
              max={UNITS_MAX}
              step={1}
              value={form.unitsNeeded}
              onChange={handleChange("unitsNeeded")}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="request-needed-by">
              Needed by
            </label>
            <input
              id="request-needed-by"
              className="input"
              type="datetime-local"
              value={form.neededBy}
              onChange={handleChange("neededBy")}
              required
            />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="request-reference">
            Patient reference (optional)
          </label>
          <input
            id="request-reference"
            className="input"
            maxLength={PATIENT_REFERENCE_MAX}
            value={form.patientReference}
            onChange={handleChange("patientReference")}
            placeholder="Your own case number, never a name"
          />
        </div>
        {isBloodBank && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.allowCompatible}
              onChange={(event) =>
                setForm((current) => ({ ...current, allowCompatible: event.target.checked }))
              }
            />
            <span>
              Compatible groups are acceptable
              <span className="block text-xs text-[#666]">
                From the third wave, donors of compatible groups are added, ranked below the exact
                group. The blood bank still cross-matches.
              </span>
            </span>
          </label>
        )}
        <button type="submit" className="btn btn-primary mt-2" disabled={isBusy}>
          {isBusy ? "Working…" : "Raise request"}
        </button>
      </form>

      {requests.length === 0 ? (
        <p className="text-sm text-[#666] mt-4">No requests raised yet.</p>
      ) : (
        requests.map((item) => (
          <RequestCard
            key={item.id}
            item={item}
            onCancel={handleCancel}
            onConfirm={handleConfirm}
            onDefer={handleDefer}
            isBusy={isBusy}
          />
        ))
      )}
    </section>
  );
}
