"use client";
import { useEffect, useState } from "react";
import axios from "axios";
import { getBloodGroupName } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { roundPinCoordinate } from "@/lib/geo";

// Where the person's blood may be needed soon (docs/PLANS/ML_system.md, Part B, in
// the closed beta): blood banks nearby whose red cells of their group may run low, by
// an admin's event or by the forecast. /api/suggestions decides who may see them
// (a complete donor profile, eligible today). Uses the profile's district until the
// person shares their location, which is rounded here and never stored.

function SuggestionItem({ suggestion }) {
  const isTeam = suggestion.source === "team";
  return (
    <li className="result-item">
      <h3 className="result-name">{suggestion.name}</h3>
      <p className="result-address">{suggestion.address}</p>
      {suggestion.distanceKm !== null && (
        <p className="text-sm text-[#d32f2f] mt-1">About {suggestion.distanceKm} km away</p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <span className="badge badge-red">
          {isTeam ? "Flagged by bloodLink's team" : "Forecast: may run low within 48 h"}
        </span>
      </div>
      <p className="text-xs text-[#666] mt-2">
        {isTeam
          ? `${suggestion.reason}${suggestion.endsAt ? ` (until ${formatDateTime(suggestion.endsAt)})` : ""}`
          : `${Math.round(suggestion.chance48 * 100)}% chance of falling to ${suggestion.thresholdUnits} units or fewer${suggestion.forecastReasons.length > 0 ? `: ${suggestion.forecastReasons.join("; ")}` : ""}.`}
      </p>
      <p className="text-xs text-[#666] mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {suggestion.phone && (
          <a
            href={`tel:${suggestion.phone.replace(/[^\d+]/g, "")}`}
            className="text-[#d32f2f] font-semibold"
          >
            📞 {suggestion.phone}
          </a>
        )}
        {Number.isFinite(Number(suggestion.latitude)) && (
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${suggestion.latitude},${suggestion.longitude}`}
            target="_blank"
            rel="noreferrer"
            className="text-[#d32f2f] font-semibold"
          >
            Directions ↗
          </a>
        )}
      </p>
    </li>
  );
}

export default function DonateNearby() {
  const [answer, setAnswer] = useState(undefined); // undefined = loading, null = failed
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState("");

  async function load(params = {}) {
    try {
      const { data } = await axios.get("/api/suggestions", { params });
      setAnswer(data);
    } catch {
      setAnswer(null);
    }
  }

  // The district's banks first, until the person shares their location.
  useEffect(() => {
    let isCancelled = false;
    axios
      .get("/api/suggestions")
      .then(({ data }) => {
        if (!isCancelled) setAnswer(data);
      })
      .catch(() => {
        if (!isCancelled) setAnswer(null);
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  function shareLocation() {
    if (!navigator.geolocation) {
      setLocationError("Your browser can't share its location.");
      return;
    }
    setIsLocating(true);
    setLocationError("");
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        await load({
          lat: roundPinCoordinate(coords.latitude),
          lng: roundPinCoordinate(coords.longitude),
        });
        setIsLocating(false);
      },
      () => {
        setLocationError("Location was not shared, so your district is used instead.");
        setIsLocating(false);
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }

  if (answer === undefined) {
    return <p className="card-body text-sm text-[#666]">Checking blood banks near you...</p>;
  }
  if (answer === null) {
    return <p className="card-body notice notice-error">Could not check blood banks near you.</p>;
  }
  if (!answer.canSuggest) {
    return <p className="card-body text-sm text-[#666]">{answer.message}</p>;
  }
  const group = getBloodGroupName(answer.bloodGroupCode) ?? "your group";
  return (
    <>
      <p className="card-body text-sm">
        {answer.basis === "location"
          ? `Blood banks within ${answer.radiusKm} km of you`
          : answer.basis === "district"
            ? "Blood banks in your district"
            : answer.message}
        {answer.basis !== "none" &&
          ` where ${group} red cells may run low soon (${answer.banksChecked} checked).`}{" "}
        <button className="btn btn-outline btn-small" disabled={isLocating} onClick={shareLocation}>
          {isLocating ? "Locating..." : "Use my location"}
        </button>
      </p>
      {locationError && <p className="card-body text-xs text-[#a52121]">{locationError}</p>}
      {answer.suggestions.length === 0 ? (
        answer.basis !== "none" && (
          <p className="card-body text-sm text-[#666]">
            None right now. Thank you for being ready to help.
          </p>
        )
      ) : (
        <ul>
          {answer.suggestions.map((suggestion) => (
            <SuggestionItem key={suggestion.hospitalCode} suggestion={suggestion} />
          ))}
        </ul>
      )}
      <p className="card-body text-xs text-[#666]">
        You may be eligible to donate; the blood centre decides. Call before you go. bloodLink never
        asks for money.
      </p>
    </>
  );
}
