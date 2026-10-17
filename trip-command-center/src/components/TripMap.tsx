"use client";

// The whole trip on one map. Lines differ by pattern, not only color:
// flights solid, drives dashed, trains dotted. Markers carry a short text tag;
// tapping one gives its address and a Google Maps link.

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import type { MapMarker, MarkerKind, TripMapData } from "@/lib/trips/map";
import { addSuperchargers } from "./chargerLayer";

const INK = "#1b1b1f";

const TAG: Record<MarkerKind, string> = {
  airport: "",
  stay: "Stay",
  stop: "Stop",
  car: "Car",
  event: "Event",
  place: "",
};

const DASH = { flight: undefined, drive: "10 8", train: "2 7" } as const;

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function markerIcon(m: MapMarker): L.DivIcon {
  const text = m.kind === "airport" ? m.label : TAG[m.kind] || m.label.slice(0, 10);
  return L.divIcon({
    html: `<div style="display:inline-block;white-space:nowrap;border:2px solid ${INK};border-radius:${m.kind === "airport" ? "4px" : "999px"};background:#fff;color:${INK};padding:2px 7px;font:700 13px system-ui;transform:translate(-50%,-50%)">${escape(text)}</div>`,
    className: "plane-icon",
    iconSize: [0, 0],
  });
}

export default function TripMap({ data }: { data: TripMapData }) {
  const ref = useRef<HTMLDivElement>(null);
  const [chargers, setChargers] = useState<number | null | undefined>(data.driveIds.length ? undefined : null);
  useEffect(() => {
    if (!ref.current) return;
    const map = L.map(ref.current);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const bounds = L.latLngBounds([]);
    for (const line of data.lines) {
      L.polyline(line.points, { color: INK, weight: line.kind === "flight" ? 2.5 : 4, dashArray: DASH[line.kind] })
        .bindTooltip(line.label, { sticky: true })
        .addTo(map);
      line.points.forEach((p) => bounds.extend(p));
    }
    for (const m of data.markers) {
      const body = `<strong>${escape(m.label)}</strong>${m.detail ? `<br>${escape(m.detail)}` : ""}<br><a href="${m.href}" target="_blank" rel="noreferrer">Open in Google Maps</a>`;
      L.marker([m.lat, m.lng], { icon: markerIcon(m), title: m.label }).bindPopup(body).addTo(map);
      bounds.extend([m.lat, m.lng]);
    }
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    else map.setView([27.34, -82.53], 9);
    if (data.driveIds.length) addSuperchargers(map, data.driveIds, setChargers);
    return () => {
      map.remove();
    };
  }, [data]);

  return (
    <div className="space-y-2">
      <div
        ref={ref}
        role="img"
        aria-label={`Trip map: ${data.markers.map((m) => m.label).join(", ")}`}
        className="h-[65vh] min-h-96 w-full overflow-hidden rounded-2xl border border-line"
      />
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <li>
          <svg width="34" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="34" y2="4" stroke={INK} strokeWidth="2.5" />
          </svg>{" "}
          Flight
        </li>
        <li>
          <svg width="34" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="34" y2="4" stroke={INK} strokeWidth="4" strokeDasharray="10 8" />
          </svg>{" "}
          Drive
        </li>
        <li>
          <svg width="34" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="34" y2="4" stroke={INK} strokeWidth="4" strokeDasharray="2 7" />
          </svg>{" "}
          Train
        </li>
        {data.driveIds.length ? <li>Red square with a bolt: Tesla Supercharger</li> : null}
      </ul>
      {data.driveIds.length ? (
        <p className="text-sm" aria-live="polite">
          {chargers === undefined
            ? "Looking for Tesla Superchargers along the drives…"
            : chargers
              ? `${chargers} Tesla Superchargers near the drives (OpenStreetMap). Tap one for stalls and directions.`
              : "No Tesla Supercharger found near the drives on OpenStreetMap."}
        </p>
      ) : null}
    </div>
  );
}
