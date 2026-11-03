"use client";

// Load this component only through next/dynamic with { ssr: false }:
// Leaflet touches `window` as soon as it is imported.
import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import axios from "axios";
import { roundPinCoordinate } from "@/lib/geo";

// ── CARTO basemap tiles ───────────────────────────────────────────────────────
// Without NEXT_PUBLIC_CARTO_API_KEY, CARTO stamps an "API key required"
// watermark over the map. The key is public by design: the browser fetches tiles.
const CARTO_API_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY;
const TILE_URL =
  "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png" +
  (CARTO_API_KEY ? `?key=${CARTO_API_KEY}` : "");
const TILE_ATTRIBUTION =
  '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> &copy; <a href="https://carto.com">CARTO</a>';

// The place name is looked up once the pin has stopped moving for this long, so a
// burst of clicks sends one lookup. The server spaces its own Nominatim requests.
const GEOCODE_DELAY_MS = 800;

const INDIA_CENTER = [20.5937, 78.9629];

// Identifies a pin position, so a geocoded label is only shown for the pin it belongs to.
function toCoordsKey({ lat, lng }) {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

function formatCoords({ lat, lng }) {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

function createPinIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="width:18px;height:18px;background:#d32f2f;border:3px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

// useMapEvents is a hook, so it lives in a child rendered inside MapContainer.
function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click(event) {
      onMapClick({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

// Props:
//   coords          — { lat, lng } | null — current pin position
//   onCoordsChange  — (coords) => void     — called on map click or GPS fix
export default function BloodMap({ coords, onCoordsChange }) {
  // A unique key gives every mount a fresh DOM node, which avoids Leaflet's
  // "Map container is being reused by another instance" error.
  const [mapKey] = useState(() => `map-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [pinIcon] = useState(createPinIcon);
  const [geocodedPlace, setGeocodedPlace] = useState(null); // { coordsKey, label } for the last geocoded pin
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [gpsError, setGpsError] = useState("");

  // Name the pin's place once it settles; a newer pin cancels the older lookup. The
  // server asks Nominatim (src/lib/geocoding.js), so the pin goes only to bloodLink.
  useEffect(() => {
    if (!coords) return undefined;
    const coordsKey = toCoordsKey(coords);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsGeocoding(true);
      try {
        const { data } = await axios.get("/api/reverse-geocode", {
          params: { lat: roundPinCoordinate(coords.lat), lng: roundPinCoordinate(coords.lng) },
          signal: controller.signal,
        });
        setGeocodedPlace({ coordsKey, label: data.label ?? null });
      } catch (err) {
        if (!axios.isCancel(err)) setGeocodedPlace({ coordsKey, label: null });
      } finally {
        setIsGeocoding(false);
      }
    }, GEOCODE_DELAY_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [coords]);

  function handleMapClick(nextCoords) {
    setGpsError("");
    onCoordsChange(nextCoords);
  }

  function handleUseMyLocation() {
    if (!navigator.geolocation) {
      setGpsError("Your browser can't share its location. Click the map instead.");
      return;
    }
    setIsLocating(true);
    setGpsError("");
    navigator.geolocation.getCurrentPosition(
      ({ coords: position }) => {
        onCoordsChange({ lat: position.latitude, lng: position.longitude });
        setIsLocating(false);
      },
      (err) => {
        setGpsError(
          (err.message || "Could not get your location.") +
            " You can click the map to drop a pin instead.",
        );
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const hasPlaceLabel =
    coords && geocodedPlace?.coordsKey === toCoordsKey(coords) && geocodedPlace.label;
  const pinLabel = hasPlaceLabel ? geocodedPlace.label : coords ? formatCoords(coords) : null;

  return (
    <div>
      <div className="map-box" style={{ position: "relative", height: 300 }}>
        <MapContainer
          key={mapKey}
          center={INDIA_CENTER}
          zoom={5}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
          <MapClickHandler onMapClick={handleMapClick} />
          {coords && <Marker position={[coords.lat, coords.lng]} icon={pinIcon} />}
        </MapContainer>

        <button
          type="button"
          onClick={handleUseMyLocation}
          disabled={isLocating}
          className="map-button"
          style={{ top: 8, right: 8, zIndex: 1000 }}
        >
          {isLocating ? "📡 Locating…" : "📍 Use My Location"}
        </button>

        {isGeocoding && (
          <div
            className="map-button"
            style={{
              bottom: 8,
              left: 8,
              zIndex: 1000,
              fontWeight: "normal",
              color: "#666",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span className="spinner" />
            Looking up location…
          </div>
        )}
      </div>

      {coords && (
        <p className="text-[13px] text-[#666] mt-2">
          📌 {pinLabel}
          {isGeocoding && " (resolving…)"}
        </p>
      )}

      {gpsError && <p className="notice notice-error mt-2">⚠️ {gpsError}</p>}
    </div>
  );
}
