"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import axios from "axios";

// ── Leaflet CSS injected once, globally, on first mount ───────────────────────
// Avoids "document is not defined" from SSR/hydration, and prevents duplicate
// <link> tags if BloodMap is mounted more than once on the same page.

let leafletCssInjected = false;

function ensureLeafletCss() {
  if (leafletCssInjected) return;
  if (typeof document === "undefined") return;
  if (!document.querySelector('link[href*="leaflet"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);
  }
  leafletCssInjected = true;
}

// ── Default icon fix — only needs to run once ─────────────────────────────────
// Next.js asset bundling strips the default icon URLs out of Leaflet's source,
// so we patch them back manually. The guard prevents repeated mergeOptions calls.

let leafletIconFixed = false;

function fixLeafletIcon() {
  if (leafletIconFixed) return;
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
  leafletIconFixed = true;
}

// ── Red pin icon for the selected location ────────────────────────────────────

const redPinIcon = () =>
  L.divIcon({
    className: "",
    html: `<div style="
      width:0;height:0;
      border-left:10px solid transparent;
      border-right:10px solid transparent;
      border-top:28px solid #e53e3e;
      position:relative;
      filter:drop-shadow(0 2px 4px rgba(0,0,0,0.35));
    ">
      <div style="
        position:absolute;top:-32px;left:-8px;
        width:16px;height:16px;
        background:#e53e3e;
        border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        border:2px solid white;
      "></div>
    </div>`,
    iconSize: [20, 28],
    iconAnchor: [10, 28],
  });

// ── ClickHandler: a hook-only child component ─────────────────────────────────
// useMapEvents is a React hook — it CANNOT be wrapped in dynamic().
// Placing it in a dedicated child component (rendered inside MapContainer)
// is the correct pattern.

function ClickHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

// ── instanceCounter gives every MapContainer a unique, stable key ─────────────
// When a component unmounts and remounts, React reuses the same DOM node by
// default. Leaflet stores a _leaflet_id on that node and throws "Map container
// is being reused by another instance" when it tries to re-initialise.
// A monotonically increasing key forces React to create a fresh DOM node.

// ─────────────────────────────────────────────────────────────────────────────
// BloodMap
//
// Props:
//   coords          — { lat, lng } | null   — current pin position
//   setCoords       — (coords) => void       — called on map click OR GPS
//   label           — string | null          — reverse-geocoded place name
//   setLabel        — (string) => void       — called after geocoding resolves
// ─────────────────────────────────────────────────────────────────────────────

export default function BloodMap({ coords, setCoords, label, setLabel }) {
  const [mapKey] = useState(() => `map-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [leafletReady, setLeafletReady] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState("");
  const iconRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Initialise Leaflet (CSS + icon fix + build icon instance) once on mount.
  useEffect(() => {
    ensureLeafletCss();
    fixLeafletIcon();
    iconRef.current = redPinIcon();
    setLeafletReady(true);
  }, []);

  // ── Reverse-geocode a { lat, lng } pair ────────────────────────────────────
  async function geocode(lat, lng) {
    setIsGeocoding(true);
    try {
      const { data } = await axios.get(
        "https://nominatim.openstreetmap.org/reverse",
        {
          params: { format: "json", lat, lon: lng },
          headers: { "Accept-Language": "en" },
        }
      );
      const addr = data.address ?? {};
      const resolved =
        addr.city ||
        addr.city_district ||
        addr.town ||
        addr.village ||
        addr.county ||
        addr.state ||
        data.display_name?.split(",")[0] ||
        `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      setLabel?.(resolved);
    } catch {
      // Geocoding failed — coords already set, label stays as coordinate string
      setLabel?.(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    } finally {
      setIsGeocoding(false);
    }
  }

  // ── Handle map click ───────────────────────────────────────────────────────
  function handleMapClick({ lat, lng }) {
    setGpsError("");
    setCoords({ lat, lng });
    setLabel?.(`${lat.toFixed(4)}, ${lng.toFixed(4)}`); // optimistic label
    geocode(lat, lng);
  }

  // ── Handle GPS button ──────────────────────────────────────────────────────
  function handleGps() {
    if (!navigator.geolocation) {
      setGpsError("Geolocation is not supported by your browser.");
      return;
    }
    setGpsLoading(true);
    setGpsError("");
    navigator.geolocation.getCurrentPosition(
      ({ coords: c }) => {
        const lat = c.latitude;
        const lng = c.longitude;
        setCoords({ lat, lng });
        setLabel?.(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        geocode(lat, lng);
        setGpsLoading(false);
      },
      (err) => {
        setGpsError(err.message || "Could not get location. Try clicking the map instead.");
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // ── Loading placeholder ────────────────────────────────────────────────────
  if (!leafletReady) {
    return (
      <div style={{
        height: 300, display: "flex", alignItems: "center",
        justifyContent: "center", background: "#f7fafc",
        color: "#a0aec0", fontSize: 14, borderRadius: 8,
      }}>
        Loading map…
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>

      {/*
        key={instanceId} forces React to create a brand-new DOM node whenever
        this component is mounted, preventing Leaflet's "container reused" error.
        useMapEvents is called inside ClickHandler (a plain component child of
        MapContainer) — it must never be wrapped in dynamic().
      */}
      <MapContainer
        ref={mapRef}
        key={mapKey}
        center={[20.5937, 78.9629]}   // India centroid
        zoom={5}
        style={{ height: 300, width: "100%", borderRadius: 8 }}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> &copy; <a href="https://carto.com">CARTO</a>'
        />
        <ClickHandler onMapClick={handleMapClick} />
        {coords && iconRef.current && (
          <Marker
            position={[coords.lat, coords.lng]}
            icon={iconRef.current}
          />
        )}
      </MapContainer>

      {/* GPS button overlaid on the map */}
      <button
        type="button"
        onClick={handleGps}
        disabled={gpsLoading}
        style={{
          position: "absolute", top: 8, right: 8, zIndex: 1000,
          background: "white", border: "none", borderRadius: 6,
          padding: "6px 10px", fontSize: 12, fontWeight: 700,
          cursor: gpsLoading ? "not-allowed" : "pointer",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          display: "flex", alignItems: "center", gap: 4,
        }}
      >
        {gpsLoading ? "📡 Locating…" : "📍 Use My Location"}
      </button>

      {/* Geocoding spinner overlaid on the map */}
      {isGeocoding && (
        <div style={{
          position: "absolute", bottom: 8, left: 8, zIndex: 1000,
          background: "white", borderRadius: 6, padding: "5px 10px",
          fontSize: 12, color: "#718096",
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <span style={{
            width: 12, height: 12,
            border: "2px solid #e2e8f0",
            borderTopColor: "#c53030",
            borderRadius: "50%",
            display: "inline-block",
            animation: "spin 0.8s linear infinite",
          }} />
          Looking up location…
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Resolved label below the map */}
      {coords && (
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#718096" }}>
          📌 {label || `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`}
          {isGeocoding && " (resolving…)"}
        </p>
      )}

      {/* GPS error message */}
      {gpsError && (
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#e53e3e" }}>
          ⚠️ {gpsError}
        </p>
      )}
    </div>
  );
}