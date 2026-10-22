"use client";

// Load this component only through next/dynamic with { ssr: false }:
// Leaflet touches `window` as soon as it is imported.
import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import axios from "axios";

// ── CARTO basemap tiles ───────────────────────────────────────────────────────
// Without NEXT_PUBLIC_CARTO_API_KEY, CARTO stamps an "API key required"
// watermark over the map. The key is public by design: the browser fetches tiles.
const cartoApiKey = process.env.NEXT_PUBLIC_CARTO_API_KEY;
const tileUrl =
  "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png" +
  (cartoApiKey ? `?key=${cartoApiKey}` : "");

// Nominatim's public server allows about one request per second, so reverse
// geocoding waits until the pin has stopped moving for this long.
const GEOCODE_DELAY_MS = 800;

const INDIA_CENTER = [20.5937, 78.9629];

function coordsKey({ lat, lng }) {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

function formatCoords({ lat, lng }) {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

function makePinIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="width:18px;height:18px;background:#d32f2f;border:3px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

// useMapEvents is a hook, so it lives in a child rendered inside MapContainer.
function ClickHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

// Props:
//   coords    — { lat, lng } | null — current pin position
//   setCoords — (coords) => void     — called on map click or GPS fix
export default function BloodMap({ coords, setCoords }) {
  // A unique key gives every mount a fresh DOM node, which avoids Leaflet's
  // "Map container is being reused by another instance" error.
  const [mapKey] = useState(() => `map-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [pinIcon] = useState(makePinIcon);
  const [place, setPlace] = useState(null); // { key, label } for the last geocoded pin
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState("");

  // Reverse-geocode the pin once it settles; a newer pin cancels the older lookup.
  useEffect(() => {
    if (!coords) return undefined;
    const key = coordsKey(coords);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsGeocoding(true);
      try {
        const { data } = await axios.get("https://nominatim.openstreetmap.org/reverse", {
          params: { format: "json", lat: coords.lat, lon: coords.lng },
          headers: { "Accept-Language": "en" },
          signal: controller.signal,
        });
        const addr = data.address ?? {};
        const label =
          addr.city || addr.city_district || addr.town || addr.village || addr.county || addr.state ||
          data.display_name?.split(",")[0] || null;
        setPlace({ key, label });
      } catch (err) {
        if (!axios.isCancel(err)) setPlace({ key, label: null });
      } finally {
        setIsGeocoding(false);
      }
    }, GEOCODE_DELAY_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [coords]);

  function handleMapClick(next) {
    setGpsError("");
    setCoords(next);
  }

  function handleGps() {
    if (!navigator.geolocation) {
      setGpsError("Your browser can't share its location. Click the map instead.");
      return;
    }
    setGpsLoading(true);
    setGpsError("");
    navigator.geolocation.getCurrentPosition(
      ({ coords: c }) => {
        setCoords({ lat: c.latitude, lng: c.longitude });
        setGpsLoading(false);
      },
      (err) => {
        setGpsError(
          (err.message || "Could not get your location.") + " You can click the map to drop a pin instead."
        );
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  const label =
    coords && place?.key === coordsKey(coords) && place.label ? place.label : coords ? formatCoords(coords) : null;

  return (
    <div>
      <div className="map-box" style={{ position: "relative", height: 300 }}>
        <MapContainer key={mapKey} center={INDIA_CENTER} zoom={5} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            url={tileUrl}
            attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> &copy; <a href="https://carto.com">CARTO</a>'
          />
          <ClickHandler onMapClick={handleMapClick} />
          {coords && <Marker position={[coords.lat, coords.lng]} icon={pinIcon} />}
        </MapContainer>

        <button
          type="button"
          onClick={handleGps}
          disabled={gpsLoading}
          className="map-button"
          style={{ top: 8, right: 8, zIndex: 1000 }}
        >
          {gpsLoading ? "📡 Locating…" : "📍 Use My Location"}
        </button>

        {isGeocoding && (
          <div
            className="map-button"
            style={{
              bottom: 8, left: 8, zIndex: 1000, fontWeight: "normal",
              color: "#666", display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <span className="spinner" />
            Looking up location…
          </div>
        )}
      </div>

      {coords && (
        <p className="text-[13px] text-[#666] mt-2">
          📌 {label}
          {isGeocoding && " (resolving…)"}
        </p>
      )}

      {gpsError && <p className="notice notice-error mt-2">⚠️ {gpsError}</p>}
    </div>
  );
}
