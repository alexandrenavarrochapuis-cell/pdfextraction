// Tesla Supercharger markers for a Leaflet map, loaded from /api/chargers for
// each drive. Browser only: imported by the map components, which load without
// server rendering.

import L from "leaflet";
import type { Charger } from "@/lib/chargers";

const ACCENT = "#2047C4";

// A square badge with a bolt, unlike the round stop markers, so shape alone
// tells chargers apart.
const icon = L.divIcon({
  html: `<div style="width:26px;height:26px;border-radius:5px;border:2px solid #fff;background:${ACCENT};display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 1.5px ${ACCENT}"><svg width="16" height="16" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M13 2 3 14h8l-1 8 10-12h-8l1-8z"/></svg></div>`,
  className: "plane-icon",
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function popup(c: Charger): string {
  const facts = [c.stalls ? `${c.stalls} stalls` : null, c.kw ? `up to ${c.kw} kW` : null].filter(Boolean).join(" · ");
  const go = `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}&travelmode=driving`;
  return `<strong>${escape(c.name)}</strong><br>Tesla Supercharger${facts ? `<br>${escape(facts)}` : ""}<br><a href="${go}" target="_blank" rel="noreferrer">Navigate in Google Maps</a>`;
}

/** Add the chargers along the given drives; returns a layer the caller can remove. */
export function addSuperchargers(map: L.Map, driveIds: string[], onCount?: (n: number | null) => void): L.LayerGroup {
  const group = L.layerGroup().addTo(map);
  const seen = new Set<string>();
  Promise.all(
    driveIds.map((id) =>
      fetch(`/api/chargers?segment=${id}`)
        .then((r) => (r.ok ? (r.json() as Promise<{ chargers: Charger[] }>) : { chargers: [] as Charger[] }))
        .catch(() => ({ chargers: [] as Charger[] })),
    ),
  ).then((results) => {
    for (const c of results.flatMap((r) => r.chargers)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      L.marker([c.lat, c.lng], { icon, title: `Tesla Supercharger: ${c.name}` }).bindPopup(popup(c)).addTo(group);
    }
    onCount?.(seen.size);
  });
  return group;
}
