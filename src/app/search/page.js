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
import { formatUpdatedAgo, isDormant, normalizeAvailabilityRow } from "@/lib/stock";
import { formatTimeAgo, hoursSince } from "@/lib/format";

const MAX_UNITS = 50;
// A saved copy older than this gets a red warning instead of a yellow one.
const SAVED_COPY_WARNING_HOURS = 24;

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
const BloodMap = dynamic(() => import("../components/BloodMap.js"), {
  ssr: false,
  loading: MapPlaceholder,
});

function getErrorMessage(err) {
  return (
    err?.response?.data?.error ||
    "Could not reach the blood bank service. Check your connection and try again."
  );
}

function formatKm(meters) {
  const km = meters / 1000;
  return km < 10 ? km.toFixed(1) : String(Math.round(km));
}

// "O-Ve Packed Red Blood Cells", or "any blood stock" when nothing is picked.
function describeFilters(componentId, bloodGroupId) {
  const parts = [
    bloodGroupId && getBloodGroupName(bloodGroupId),
    componentId && getComponentName(componentId),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "any blood stock";
}

function StockBadges({ stock }) {
  if (stock.totalUnits === 0) {
    return <span className="badge">No matching stock</span>;
  }
  return stock.components.map((componentStock) => (
    <span key={componentStock.component} className="badge badge-green">
      <strong>{componentStock.component}:</strong>{" "}
      {componentStock.units
        .map((groupStock) => `${groupStock.group} ${groupStock.units}`)
        .join(", ")}
    </span>
  ));
}

function RankingDetails({ bank }) {
  return (
    <div className="mt-2">
      <p className="text-xs font-semibold text-[#d32f2f]">
        #{bank.rank} · score {bank.score}/100 · about {bank.etaMinutes} min away
      </p>
      <ul className="text-xs text-[#666] mt-1 list-disc ml-5">
        {bank.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}

function PlanCard({ plan, label }) {
  return (
    <div className="card card-body mb-3">
      <h2 className="font-semibold text-[#222]">
        Suggested plan for {plan.unitsNeeded} unit(s) of {label}
      </h2>
      <ol className="text-sm mt-2 list-decimal ml-5">
        {plan.steps.map((step) => (
          <li key={step.hospitalCode} className="mt-1">
            <strong>{step.name}</strong>: {step.units} {step.units === 1 ? "unit" : "units"}
            <span className="text-[#666]"> · about {step.etaMinutes} min</span>
            {step.phone && <span className="text-[#666]"> · call {step.phone}</span>}
          </li>
        ))}
      </ol>
      {plan.shortfall > 0 ? (
        <p className="notice notice-warn mt-3">
          Only {plan.unitsCovered} of {plan.unitsNeeded} units found nearby. Call the banks above
          and your nearest hospital.
        </p>
      ) : (
        <p className="text-xs text-[#666] mt-2">
          Call each bank to confirm and reserve before travelling.
        </p>
      )}
      <p className="text-xs text-[#666] mt-2">
        Only banks listing the exact blood group are shown. Ranking weighs travel time at this hour,
        whether the bank covers the request, spare stock beyond it (weighted more when urgent) and
        how recently stock was updated. The blood bank must still cross-match before transfusion.
      </p>
    </div>
  );
}

// "6.2 km by road · about 24 min now", or the straight-line distance when there is no route.
function describeDistance(bank) {
  if (bank.roadDistanceM) {
    return `${formatKm(bank.roadDistanceM)} km by road · about ${bank.etaMinutes} min now`;
  }
  const eta = bank.etaMinutes ? ` · about ${bank.etaMinutes} min now (estimated)` : "";
  return `${formatKm(bank.distanceM)} km away (straight line)${eta}`;
}

// "Travel times use road routes and Mumbai traffic for Fri 6:05 pm (rush-hour traffic, +112%)."
function TravelNote({ travel }) {
  const place = travel.city ? `${travel.city} traffic` : `typical ${travel.zone}-area traffic`;
  const basis =
    travel.roadRoutes > 0 ? "road routes" : "straight-line distance (road routing unavailable)";
  return (
    <p className="text-xs font-normal text-[#666] mt-1">
      Travel times use {basis} and {place} for {travel.localTime} ({travel.label}, +
      {Math.round(travel.congestionPercent)}%)
      {travel.rainFactor > 1 && `, slowed for rain (${travel.rainMmPerHour} mm/h)`}. They are
      estimates.
    </p>
  );
}

function BankItem({ bank }) {
  const updatedAgo = formatUpdatedAgo(bank.entryDate);
  const checkedAgo = formatTimeAgo(bank.checkedAt);
  const hasCoords =
    Number.isFinite(Number(bank.latitude)) && Number.isFinite(Number(bank.longitude));
  return (
    <li className="result-item">
      <h3 className="result-name">{bank.name}</h3>
      <p className="result-address">{bank.address}</p>
      {bank.distanceM !== undefined && (
        <p className="text-sm text-[#d32f2f] mt-1">{describeDistance(bank)}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <StockBadges stock={bank.stock} />
        {bank.isDormant && (
          <span className="badge badge-red">
            Not updated for 30+ days: call before relying on it
          </span>
        )}
      </div>
      {bank.rank && <RankingDetails bank={bank} />}
      <p className="text-xs text-[#666] mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {updatedAgo && (
          <span>
            Bank {updatedAgo}
            {checkedAgo && ` · checked ${checkedAgo}`}
          </span>
        )}
        {bank.phone && (
          <a
            href={`tel:${bank.phone.replace(/[^\d+]/g, "")}`}
            className="text-[#d32f2f] font-semibold"
          >
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

// The heading above the result list, which depends on the kind of search.
function describeResults({ mode, banks, meta, label, place }) {
  if (meta?.mode === "ranked") {
    return `${banks.length} ranked source(s) with ${meta.bloodGroup} within ${formatKm(meta.ringRadiusM)} km (${meta.area} search)`;
  }
  if (mode === "location") {
    return `${label} within ${formatKm(meta.ringRadiusM)} km (${meta.area} search, ${banks.length} found)`;
  }
  const stockedCount = banks.filter((bank) => bank.stock.totalUnits > 0).length;
  return `Blood banks in ${place}: ${stockedCount} of ${banks.length} have ${label}`;
}

// Where the stock came from and how old it is. Nothing when it is live. The age
// shown is the oldest stock copy used, so it is never flattering.
function FreshnessBanner({ freshness }) {
  if (!freshness) return null;
  const isBackup = freshness.source === "memory" || freshness.source === "saved";
  const savedAgo = formatTimeAgo(freshness.oldestFetchedAt);
  const savedHours = hoursSince(freshness.oldestFetchedAt);
  const reason =
    freshness.upstream === "degraded"
      ? "eRaktKosh is slow right now"
      : "eRaktKosh isn't responding";
  const failedStates = freshness.failedStates ?? [];
  return (
    <>
      {isBackup &&
        (savedHours !== null && savedHours < SAVED_COPY_WARNING_HOURS ? (
          <p className="notice notice-warn mb-3">
            {reason}, so this shows stock bloodLink saved {savedAgo}.
          </p>
        ) : (
          <p className="notice notice-error mb-3">
            {reason}, and some of the stock shown was saved {savedAgo ?? "at an unknown time"}. It
            has probably changed: call every bank before travelling.
          </p>
        ))}
      {failedStates.length > 0 && (
        <p className="notice notice-warn mb-3">
          Couldn&apos;t check {failedStates.join(", ")}. Banks there may be missing.
        </p>
      )}
    </>
  );
}

function SearchResults({ result }) {
  const { mode, banks, meta, label } = result;

  return (
    <div className="mt-5 max-w-xl">
      <FreshnessBanner freshness={result.freshness ?? meta?.freshness} />

      {mode === "location" && banks.length === 0 ? (
        <p className="notice notice-warn">
          No {label} found within {formatKm(meta.maxRadiusM)} km of the pin. {meta.banksChecked}{" "}
          blood banks nearby were checked. Try another blood group or component, or call your
          nearest hospital.
        </p>
      ) : mode === "region" && banks.length === 0 ? (
        <p className="text-sm text-[#666]">No blood banks are listed for this area.</p>
      ) : (
        <>
          {meta?.mode === "ranked" && <PlanCard plan={meta.plan} label={label} />}
          <div className="card">
            <div className="card-title">
              <h2>{describeResults(result)}</h2>
              {meta?.travel && <TravelNote travel={meta.travel} />}
              {meta?.misplacedBanks > 0 && (
                <p className="text-xs font-normal text-[#666] mt-1">
                  {meta.misplacedBanks} more {meta.misplacedBanks === 1 ? "bank is" : "banks are"}{" "}
                  left out: eRaktKosh places them outside their own state, so their distance is
                  unknown. Search by state to see them.
                </p>
              )}
            </div>
            <ul>
              {banks.map((bank) => (
                <BankItem key={bank.hospitalCode} bank={bank} />
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export default function SearchPage() {
  const [componentId, setComponentId] = useState("");
  const [bloodGroupId, setBloodGroupId] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [districtCode, setDistrictCode] = useState("");
  const [coords, setCoords] = useState(null);
  const [activeSearch, setActiveSearch] = useState(null); // "region" | "location" | null
  const [lastSearch, setLastSearch] = useState(null); // what Retry runs again
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [unitsNeeded, setUnitsNeeded] = useState(1);
  const [urgency, setUrgency] = useState("urgent");

  const districts = districtsFor(stateCode);
  const canRank = Boolean(componentId && bloodGroupId);
  const isSearching = activeSearch !== null;

  function buildFilterParams() {
    const params = new URLSearchParams();
    if (componentId) params.set("componentId", componentId);
    if (bloodGroupId) params.set("bloodGroupId", bloodGroupId);
    return params;
  }

  function startSearch(mode) {
    setLastSearch(mode);
    setActiveSearch(mode);
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
      const params = buildFilterParams();
      params.set("stateCode", stateCode);
      if (districtCode) params.set("districtId", districtCode);
      const response = await axios.get(`/api/search?${params}`);
      const fetchedAt = response.headers["x-data-fetched-at"] ?? null;
      const banks = response.data
        .map((row) => ({
          ...normalizeAvailabilityRow(row, stockFilters),
          checkedAt: fetchedAt,
          isDormant: isDormant(row.entrydate),
        }))
        .sort((a, b) => b.stock.totalUnits - a.stock.totalUnits);
      setResult({
        mode: "region",
        banks,
        freshness: {
          source: response.headers["x-data-source"] ?? "live",
          fetchedAt,
          oldestFetchedAt: fetchedAt,
          upstream: response.headers["x-data-upstream"] ?? "ok",
          failedStates: [],
        },
        label: describeFilters(componentId, bloodGroupId),
        place: districtCode
          ? `${getDistrictName(stateCode, districtCode)}, ${getStateName(stateCode)}`
          : getStateName(stateCode),
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setActiveSearch(null);
    }
  }

  async function handleLocationSearch() {
    if (!coords) return;
    startSearch("location");
    try {
      const params = buildFilterParams();
      params.set("lat", String(coords.lat));
      params.set("lng", String(coords.lng));
      if (canRank) {
        params.set("units", String(unitsNeeded));
        params.set("urgency", urgency);
      }
      const { data } = await axios.get(`/api/blood-search?${params}`);
      setResult({
        mode: "location",
        banks: data.results,
        meta: data,
        label: describeFilters(componentId, bloodGroupId),
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setActiveSearch(null);
    }
  }

  return (
    <div className="page-wrap">
      <h1 className="page-title">Search Blood Availability</h1>
      <p className="page-subtitle">
        Pick a state and district, or drop a pin on the map to find the nearest blood banks with
        stock.
      </p>

      <div className="card card-body mt-5 max-w-xl">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="component">
              Blood Component
            </label>
            <select
              id="component"
              className="select"
              value={componentId}
              onChange={(event) => setComponentId(event.target.value)}
            >
              <option value="">Any component</option>
              {COMPONENTS.map((component) => (
                <option key={component.code} value={component.code}>
                  {component.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="bloodGroup">
              Blood Group
            </label>
            <select
              id="bloodGroup"
              className="select"
              value={bloodGroupId}
              onChange={(event) => setBloodGroupId(event.target.value)}
            >
              <option value="">Any blood group</option>
              {BLOOD_GROUPS.map((group) => (
                <option key={group.code} value={group.code}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="state">
              State
            </label>
            <select
              id="state"
              className="select"
              value={stateCode}
              onChange={(event) => {
                setStateCode(event.target.value);
                setDistrictCode("");
              }}
            >
              <option value="">Select State</option>
              {STATES.map((state) => (
                <option key={state.stateCode} value={state.stateCode}>
                  {state.stateName}
                </option>
              ))}
            </select>
          </div>

          {districts.length > 0 && (
            <div>
              <label className="label" htmlFor="district">
                District
              </label>
              <select
                id="district"
                className="select"
                value={districtCode}
                onChange={(event) => setDistrictCode(event.target.value)}
              >
                <option value="">All districts</option>
                {districts.map((district) => (
                  <option key={district.districtCode} value={district.districtCode}>
                    {district.districtName}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {canRank ? (
          <div className="grid gap-4 sm:grid-cols-2 mt-4 pt-4 border-t border-[#e0e0e0]">
            <div>
              <label className="label" htmlFor="units">
                Units needed
              </label>
              <input
                id="units"
                type="number"
                min={1}
                max={MAX_UNITS}
                className="input"
                value={unitsNeeded}
                onChange={(event) =>
                  setUnitsNeeded(Math.min(MAX_UNITS, Math.max(1, Number(event.target.value) || 1)))
                }
              />
            </div>
            <div>
              <label className="label" htmlFor="urgency">
                Urgency
              </label>
              <select
                id="urgency"
                className="select"
                value={urgency}
                onChange={(event) => setUrgency(event.target.value)}
              >
                <option value="critical">Critical</option>
                <option value="urgent">Urgent</option>
                <option value="routine">Routine</option>
              </select>
            </div>
          </div>
        ) : (
          <p className="text-xs text-[#666] mt-3">
            Pick both a component and a blood group to rank nearby sources and get a suggested plan.
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-2 mt-5">
          <button
            className="btn btn-primary"
            disabled={!stateCode || isSearching}
            onClick={handleRegionSearch}
          >
            {activeSearch === "region" ? "Searching…" : "Search this area"}
          </button>
          <button
            className="btn btn-outline"
            disabled={!coords || isSearching}
            onClick={handleLocationSearch}
          >
            {activeSearch === "location" ? "Searching nearby…" : "📍 Search near the pin"}
          </button>
        </div>
        {!coords && (
          <p className="text-xs text-[#666] mt-2">
            To search by location, drop a pin on the map below or use your location.
          </p>
        )}
      </div>

      <div className="card card-body mt-5 max-w-xl">
        <span className="label">Pick your location</span>
        <BloodMap coords={coords} onCoordsChange={setCoords} />
      </div>

      {error && (
        <div className="notice notice-error mt-5 max-w-xl flex items-center justify-between gap-3">
          <span>{error}</span>
          {lastSearch && (
            <button
              className="btn btn-outline btn-small"
              disabled={isSearching}
              onClick={lastSearch === "region" ? handleRegionSearch : handleLocationSearch}
            >
              Retry
            </button>
          )}
        </div>
      )}
      {result && <SearchResults result={result} />}

      <p className="text-xs text-[#666] mt-6 max-w-xl">
        Stock comes from eRaktKosh and may be out of date. Always call the blood bank before
        travelling.
      </p>
      <p className="text-xs text-[#999] mt-2 max-w-xl">
        Routes: OSRM, map data © OpenStreetMap contributors. Traffic patterns: TomTom Traffic Index
        2025. Weather: Open-Meteo. State outlines: DataMeet India community via geoBoundaries (CC BY
        2.5 IN).
      </p>
    </div>
  );
}
