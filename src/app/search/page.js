"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import axios from "axios";
import {
  BLOOD_GROUPS,
  COMPONENTS,
  STATES,
  districtsFor,
  getBloodGroupName,
  getComponentName,
  getDistrictName,
  getStateName,
} from "@/lib/constants";
import { formatUpdatedAgo, normalizeAvailabilityRow } from "@/lib/stock";

function MapPlaceholder() {
  return (
    <div
      className="map-box flex items-center justify-center gap-2 text-sm text-[#666]"
      style={{ height: 300, background: "#f0f0f0" }}
    >
      <span className="spinner" />
      Loading map…
    </div>
  );
}

// Leaflet needs `window`, so the map only renders in the browser.
const BloodMap = dynamic(() => import("../components/Map.js"), { ssr: false, loading: MapPlaceholder });

function errorMessage(err) {
  return (
    err?.response?.data?.error ||
    "Could not reach the blood bank service. Check your connection and try again."
  );
}

function formatKm(meters) {
  const km = meters / 1000;
  return km < 10 ? km.toFixed(1) : String(Math.round(km));
}

function describeFilters(componentId, bloodGroupId) {
  const parts = [bloodGroupId && getBloodGroupName(bloodGroupId), componentId && getComponentName(componentId)].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "any blood stock";
}

function StockBadges({ stock }) {
  if (stock.totalUnits === 0) {
    return <span className="badge">No matching stock</span>;
  }
  return stock.components.map((c) => (
    <span key={c.component} className="badge badge-green">
      <strong>{c.component}:</strong> {c.units.map((u) => `${u.group} ${u.units}`).join(", ")}
    </span>
  ));
}

function BankItem({ bank }) {
  const updated = formatUpdatedAgo(bank.entrydate);
  const hasCoords = Number.isFinite(Number(bank.latitude)) && Number.isFinite(Number(bank.longitude));
  return (
    <li className="result-item">
      <h3 className="result-name">{bank.name}</h3>
      <p className="result-address">{bank.address}</p>
      {bank.distanceM !== undefined && (
        <p className="text-sm text-[#d32f2f] mt-1">{formatKm(bank.distanceM)} km away (straight line)</p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <StockBadges stock={bank.stock} />
      </div>
      <p className="text-xs text-[#666] mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {updated && <span>Stock {updated}</span>}
        {bank.phone && (
          <a href={`tel:${bank.phone.replace(/[^\d+]/g, "")}`} className="text-[#d32f2f] font-semibold">
            📞 {bank.phone}
          </a>
        )}
        {hasCoords && (
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${bank.latitude},${bank.longitude}`}
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

function Results({ result }) {
  const { mode, banks, meta, stale, label } = result;
  const isStale = stale || meta?.stale;

  return (
    <div className="mt-5 max-w-xl">
      {isStale && (
        <p className="notice notice-warn mb-3">
          eRaktKosh did not respond just now, so some of this is the last data we saved.
        </p>
      )}
      {meta?.partial && (
        <p className="notice notice-warn mb-3">Some nearby states could not be checked. Results may be incomplete.</p>
      )}

      {mode === "location" && banks.length === 0 ? (
        <p className="notice notice-warn">
          No {label} found within {formatKm(meta.maxRadiusM)} km of the pin. {meta.banksChecked} blood banks nearby
          were checked. Try another blood group or component, or call your nearest hospital.
        </p>
      ) : mode === "region" && banks.length === 0 ? (
        <p className="text-sm text-[#666]">No blood banks are listed for this area.</p>
      ) : (
        <div className="card">
          <h2 className="card-title">
            {mode === "location"
              ? `${label} within ${formatKm(meta.ringRadiusM)} km (${meta.area} search, ${banks.length} found)`
              : `Blood banks in ${result.place}: ${banks.filter((b) => b.stock.totalUnits > 0).length} of ${banks.length} have ${label}`}
          </h2>
          <ul>
            {banks.map((bank) => (
              <BankItem key={bank.hospitalCode} bank={bank} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function Search() {
  const [componentId, setComponentId] = useState("");
  const [bloodGroupId, setBloodGroupId] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [districtCode, setDistrictCode] = useState("");
  const [coords, setCoords] = useState(null);
  const [loading, setLoading] = useState(null); // "region" | "location" | null
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const districts = districtsFor(stateCode);

  function filterParams() {
    const params = new URLSearchParams();
    if (componentId) params.set("componentId", componentId);
    if (bloodGroupId) params.set("bloodGroupId", bloodGroupId);
    return params;
  }

  function startSearch(mode) {
    setLoading(mode);
    setError("");
    setResult(null);
  }

  async function handleRegionSearch() {
    if (!stateCode) return;
    startSearch("region");
    const stockFilters = {
      componentName: componentId ? getComponentName(componentId) : null,
      bloodGroupName: bloodGroupId ? getBloodGroupName(bloodGroupId) : null,
    };
    try {
      const params = filterParams();
      params.set("stateCode", stateCode);
      if (districtCode) params.set("districtId", districtCode);
      const response = await axios.get(`/api/search?${params}`);
      const banks = response.data
        .map((row) => normalizeAvailabilityRow(row, stockFilters))
        .sort((a, b) => b.stock.totalUnits - a.stock.totalUnits);
      setResult({
        mode: "region",
        banks,
        stale: response.headers["x-data-stale"] === "1",
        label: describeFilters(componentId, bloodGroupId),
        place: districtCode
          ? `${getDistrictName(stateCode, districtCode)}, ${getStateName(stateCode)}`
          : getStateName(stateCode),
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(null);
    }
  }

  async function handleLocationSearch() {
    if (!coords) return;
    startSearch("location");
    try {
      const params = filterParams();
      params.set("lat", String(coords.lat));
      params.set("lng", String(coords.lng));
      const { data } = await axios.get(`/api/blood-search?${params}`);
      setResult({ mode: "location", banks: data.results, meta: data, label: describeFilters(componentId, bloodGroupId) });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="page-wrap">
      <h1 className="page-title">Search Blood Availability</h1>
      <p className="page-subtitle">
        Pick a state and district, or drop a pin on the map to find the nearest blood banks with stock.
      </p>

      <div className="card card-body mt-5 max-w-xl">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="component">Blood Component</label>
            <select id="component" className="select" value={componentId} onChange={(e) => setComponentId(e.target.value)}>
              <option value="">Any component</option>
              {COMPONENTS.map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="group">Blood Group</label>
            <select id="group" className="select" value={bloodGroupId} onChange={(e) => setBloodGroupId(e.target.value)}>
              <option value="">Any blood group</option>
              {BLOOD_GROUPS.map((g) => (
                <option key={g.code} value={g.code}>{g.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="state">State</label>
            <select
              id="state"
              className="select"
              value={stateCode}
              onChange={(e) => {
                setStateCode(e.target.value);
                setDistrictCode("");
              }}
            >
              <option value="">Select State</option>
              {STATES.map((s) => (
                <option key={s.stateCode} value={s.stateCode}>{s.stateName}</option>
              ))}
            </select>
          </div>

          {districts.length > 0 && (
            <div>
              <label className="label" htmlFor="district">District</label>
              <select id="district" className="select" value={districtCode} onChange={(e) => setDistrictCode(e.target.value)}>
                <option value="">All districts</option>
                {districts.map((d) => (
                  <option key={d.districtCode} value={d.districtCode}>{d.districtName}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2 mt-5">
          <button className="btn btn-primary" disabled={!stateCode || loading !== null} onClick={handleRegionSearch}>
            {loading === "region" ? "Searching…" : "Search this area"}
          </button>
          <button className="btn btn-outline" disabled={!coords || loading !== null} onClick={handleLocationSearch}>
            {loading === "location" ? "Searching nearby…" : "📍 Search near the pin"}
          </button>
        </div>
        {!coords && (
          <p className="text-xs text-[#666] mt-2">To search by location, drop a pin on the map below or use your location.</p>
        )}
      </div>

      <div className="card card-body mt-5 max-w-xl">
        <span className="label">Pick your location</span>
        <BloodMap coords={coords} setCoords={setCoords} />
      </div>

      {error && <p className="notice notice-error mt-5 max-w-xl">{error}</p>}
      {result && <Results result={result} />}

      <p className="text-xs text-[#666] mt-6 max-w-xl">
        Stock comes from eRaktKosh and may be out of date. Always call the blood bank before travelling.
      </p>
    </div>
  );
}
