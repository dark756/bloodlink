"use client";

// A small map for choosing up to two areas (home and work). Load it only through
// next/dynamic with { ssr: false }: Leaflet touches `window` as soon as it is imported.
// Unlike the search map it never looks up a place name, so a chosen area goes nowhere
// but the browser until the person saves it, rounded to about 1 km.
import "leaflet/dist/leaflet.css";
import { useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";

const CARTO_API_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY;
const TILE_URL =
  "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png" +
  (CARTO_API_KEY ? `?key=${CARTO_API_KEY}` : "");
const TILE_ATTRIBUTION =
  '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> &copy; <a href="https://carto.com">CARTO</a>';
const INDIA_CENTER = [20.5937, 78.9629];
const KIND_COLORS = { home: "#d32f2f", work: "#1565c0" };

function createIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div style="width:18px;height:18px;background:${color};border:3px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function ClickHandler({ onPick }) {
  useMapEvents({
    click(event) {
      onPick({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    },
  });
  return null;
}

// Props:
//   areas   - [{ kind, latitude, longitude }] - the areas chosen so far
//   onPick  - ({ latitude, longitude }) => void - called on a map click
export default function AreaMap({ areas, onPick }) {
  const [mapKey] = useState(() => `area-map-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [icons] = useState(() => ({
    home: createIcon(KIND_COLORS.home),
    work: createIcon(KIND_COLORS.work),
  }));
  const first = areas[0];
  return (
    <div className="h-64 w-full overflow-hidden rounded-lg border border-[#e0e0e0]">
      <MapContainer
        key={mapKey}
        center={first ? [first.latitude, first.longitude] : INDIA_CENTER}
        zoom={first ? 11 : 5}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <ClickHandler onPick={onPick} />
        {areas.map((area) => (
          <Marker
            key={area.kind}
            position={[area.latitude, area.longitude]}
            icon={icons[area.kind]}
          />
        ))}
      </MapContainer>
    </div>
  );
}
