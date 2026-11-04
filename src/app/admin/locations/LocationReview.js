"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import axios from "axios";
import { SHOWN_PRECISION_M } from "@/lib/bankLocations";

// Leaflet touches window on import, so the map loads in the browser only.
const BloodMap = dynamic(() => import("../../components/BloodMap"), {
  ssr: false,
  loading: () => <p className="text-sm text-[#666]">Loading map…</p>,
});

const formatKm = (meters) => (meters / 1000).toFixed(meters < 10_000 ? 1 : 0);

// One bank on /admin/locations: what is known, the proposed position, and the
// decisions. The pin moves with a click on the map. The links open OpenStreetMap and a
// web search in a new tab, for the admin's own checking; this page sends nothing to
// outside services itself, beyond the map tiles and the pin's place name.
export default function LocationReview({ bank }) {
  const router = useRouter();
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [pin, setPin] = useState(
    bank.fix ? { lat: bank.fix.latitude, lng: bank.fix.longitude } : null,
  );
  const [note, setNote] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");

  const searchText = [bank.name, bank.address].filter(Boolean).join(", ");
  const hasMovedPin =
    pin && (!bank.fix || pin.lat !== bank.fix.latitude || pin.lng !== bank.fix.longitude);
  const evidence = bank.fix?.evidence ?? {};

  async function decide(decision) {
    if (decision === "cant_place" && !window.confirm(`Mark ${bank.name} as can't be placed?`)) {
      return;
    }
    setIsBusy(true);
    setError("");
    try {
      await axios.post("/api/admin/locations/review", {
        hospitalCode: bank.hospitalCode,
        decision,
        ...(decision === "moved" ? { latitude: pin.lat, longitude: pin.lng } : {}),
        note: note.trim() || null,
      });
      router.refresh();
    } catch (err) {
      setError(err?.response?.data?.error || "The action failed. Please try again.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <li className="result-item">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="result-name">{bank.name}</h3>
        <span className={bank.fix?.status === "proposed" ? "badge badge-red" : "badge"}>
          {bank.fix?.status === "proposed"
            ? "Waiting for review"
            : bank.fix?.status === "rejected"
              ? "Rejected"
              : "No position yet"}
        </span>
      </div>
      <p className="result-address">
        {bank.address || "No address"}
        {bank.place && ` · ${bank.place}`}
      </p>
      <p className="text-xs text-[#666] mt-1">
        Code {bank.hospitalCode}
        {bank.type && ` · ${bank.type}`} · {bank.units} {bank.units === 1 ? "unit" : "units"} listed
        · {bank.reason}
      </p>
      {bank.fix && (
        <p className="text-sm mt-2">
          Proposed from {bank.fix.method}
          {bank.fix.precisionM > SHOWN_PRECISION_M &&
            `, accurate to about ${formatKm(bank.fix.precisionM)} km`}
          {evidence.name && `: matched “${evidence.name}”`}
          {evidence.datagovName && `: matched “${evidence.datagovName}”`}
          {evidence.townOnly && " (on the town's name only)"}
          {evidence.note && ` · note: ${evidence.note}`}
          {evidence.displayName && (
            <span className="block text-xs text-[#666]">{evidence.displayName}</span>
          )}
        </p>
      )}
      <p className="text-xs mt-2 flex flex-wrap gap-x-3">
        <a
          href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(searchText)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Search OpenStreetMap
        </a>
        <a
          href={`https://duckduckgo.com/?q=${encodeURIComponent(searchText)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Search the web
        </a>
        {bank.fix && (
          <a
            href={`https://www.openstreetmap.org/?mlat=${bank.fix.latitude}&mlon=${bank.fix.longitude}#map=17/${bank.fix.latitude}/${bank.fix.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Open the proposed point
          </a>
        )}
        <button type="button" className="underline" onClick={() => setIsMapOpen(!isMapOpen)}>
          {isMapOpen ? "Hide the map" : "Show the map"}
        </button>
      </p>
      {isMapOpen && (
        <div className="mt-2">
          <BloodMap
            coords={pin}
            onCoordsChange={setPin}
            initialCenter={pin ? [pin.lat, pin.lng] : undefined}
            initialZoom={pin ? 15 : 5}
          />
          <p className="text-xs text-[#666] mt-1">Click the map to move the pin.</p>
        </div>
      )}
      <input
        className="input mt-2"
        placeholder="Note (optional): how you checked it"
        value={note}
        maxLength={500}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="flex flex-wrap gap-2 mt-2">
        {bank.fix?.status === "proposed" && (
          <button
            className="btn btn-small btn-primary"
            disabled={isBusy}
            onClick={() => decide("accepted")}
          >
            Accept
          </button>
        )}
        <button
          className="btn btn-small btn-outline"
          disabled={isBusy || !hasMovedPin}
          title={hasMovedPin ? "" : "Open the map and click where the bank is"}
          onClick={() => decide("moved")}
        >
          {bank.fix ? "Move pin and accept" : "Place here and accept"}
        </button>
        {bank.fix?.status === "proposed" && (
          <button
            className="btn btn-small btn-outline"
            disabled={isBusy}
            onClick={() => decide("rejected")}
          >
            Reject
          </button>
        )}
        <button
          className="btn btn-small btn-outline"
          disabled={isBusy}
          onClick={() => decide("cant_place")}
        >
          Can&apos;t place
        </button>
      </div>
      {error && <p className="notice notice-error mt-2">{error}</p>}
    </li>
  );
}
