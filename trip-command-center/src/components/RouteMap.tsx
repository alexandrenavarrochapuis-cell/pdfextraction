"use client";

// Road-trip overview: numbered stops joined by straight dashed lines. Turn-by-
// turn routing comes from Google Maps; this map is for seeing the plan.

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";

export interface RoutePoint {
  lat: number;
  lng: number;
  label: string;
  marker: string; // "S", "1", "2", ..., "E"
}

const INK = "#1b1b1f";

function badge(text: string, end: boolean): L.DivIcon {
  // Start and end are squares, stops are circles; every marker carries its text.
  const radius = end ? "4px" : "999px";
  return L.divIcon({
    html: `<div style="width:30px;height:30px;border-radius:${radius};border:2.5px solid ${INK};background:${end ? INK : "#fff"};color:${end ? "#fff" : INK};display:flex;align-items:center;justify-content:center;font:700 14px system-ui">${text}</div>`,
    className: "plane-icon",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

export default function RouteMap({ points }: { points: RoutePoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !points.length) return;
    const map = L.map(ref.current);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const latlngs = points.map((p) => [p.lat, p.lng] as L.LatLngTuple);
    L.polyline(latlngs, { color: INK, weight: 3, dashArray: "8 8" }).addTo(map);
    points.forEach((p, i) => {
      const end = i === 0 || i === points.length - 1;
      L.marker([p.lat, p.lng], { icon: badge(p.marker, end) })
        .addTo(map)
        .bindTooltip(p.label, { permanent: true, direction: "right", className: "map-label", offset: [16, 0] });
    });
    map.fitBounds(L.latLngBounds(latlngs), { padding: [48, 48], maxZoom: 13 });
    return () => {
      map.remove();
    };
  }, [points]);
  return (
    <div
      ref={ref}
      role="img"
      aria-label={`Route through ${points.map((p) => p.label).join(", ")}`}
      className="h-[55vh] min-h-80 w-full overflow-hidden rounded-2xl border border-line"
    />
  );
}
