"use client";

// Airport map: gates, restrooms, food, lounges, shops, security and services
// from OpenStreetMap, your live position, and walking distance to a gate.
// Every marker carries a text label in a shape, so nothing relies on color.

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { findGate, type AirportPoi, type PoiCategory } from "@/lib/airport/pois";

const INK = "#1b1b1f";

const CATEGORY: Record<PoiCategory, { label: string; short: string; radius: string }> = {
  gate: { label: "Gates", short: "", radius: "4px" },
  restroom: { label: "Restrooms", short: "WC", radius: "999px" },
  food: { label: "Food", short: "Eat", radius: "999px" },
  lounge: { label: "Lounges", short: "Lng", radius: "2px" },
  shop: { label: "Shops", short: "Shop", radius: "999px" },
  security: { label: "Security", short: "Sec", radius: "2px" },
  service: { label: "Services", short: "Svc", radius: "999px" },
  info: { label: "Info", short: "i", radius: "999px" },
};

const DEFAULT_ON: PoiCategory[] = ["gate", "restroom", "lounge", "security", "food"];
const WALK_M_PER_MIN = 80;

function icon(p: AirportPoi, target: boolean): L.DivIcon {
  const c = CATEGORY[p.category];
  const text = p.category === "gate" ? p.ref ?? "Gate" : c.short;
  const style = [
    `border-radius:${c.radius}`,
    `border:${target ? 4 : 2}px solid ${INK}`,
    `background:${target ? INK : "#fff"}`,
    `color:${target ? "#fff" : INK}`,
    "font:700 12px system-ui",
    "padding:2px 5px",
    "white-space:nowrap",
  ].join(";");
  return L.divIcon({ html: `<div style="${style}">${text}</div>`, className: "plane-icon", iconSize: undefined, iconAnchor: [14, 10] });
}

function youIcon(): L.DivIcon {
  return L.divIcon({
    html: `<svg width="30" height="30" viewBox="0 0 30 30"><path d="M15 2 27 27 15 21 3 27Z" fill="${INK}" stroke="#fff" stroke-width="2"/></svg>`,
    className: "plane-icon",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(toRad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default function AirportMap({
  pois,
  center,
  initialGate,
}: {
  pois: AirportPoi[];
  center: { lat: number; lng: number };
  initialGate?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const youRef = useRef<{ marker: L.Marker; circle: L.Circle } | null>(null);
  const [visible, setVisible] = useState<Set<PoiCategory>>(new Set(DEFAULT_ON));
  const [target, setTarget] = useState<AirportPoi | null>(() => (initialGate ? findGate(pois, initialGate) : null));
  const [query, setQuery] = useState(initialGate ?? "");
  const [you, setYou] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);

  const counts = useMemo(() => {
    const c = new Map<PoiCategory, number>();
    for (const p of pois) c.set(p.category, (c.get(p.category) ?? 0) + 1);
    return c;
  }, [pois]);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = L.map(ref.current, { maxZoom: 20 }).setView([center.lat, center.lng], 15);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 20,
      maxNativeZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      youRef.current = null;
    };
  }, [center.lat, center.lng]);

  // Markers for the selected categories.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const p of pois) {
      const isTarget = target?.id === p.id;
      if (!visible.has(p.category) && !isTarget) continue;
      const label = [p.category === "gate" ? `Gate ${p.ref ?? ""}` : p.name ?? CATEGORY[p.category].label, p.level ? `level ${p.level}` : null]
        .filter(Boolean)
        .join(" · ");
      L.marker([p.lat, p.lng], { icon: icon(p, isTarget), zIndexOffset: isTarget ? 1000 : 0, title: label })
        .bindTooltip(label, { className: "map-label", direction: "top", offset: [0, -8] })
        .on("click", () => setTarget(p))
        .addTo(layer);
    }
  }, [pois, visible, target]);

  useEffect(() => {
    if (target && mapRef.current) mapRef.current.setView([target.lat, target.lng], 19);
  }, [target]);

  // Live position.
  useEffect(() => {
    if (!watching) return;
    if (!("geolocation" in navigator)) {
      const t = setTimeout(() => setGpsError("Location is not available on this device."), 0);
      return () => clearTimeout(t);
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsError(null);
        setYou({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
      },
      (err) => setGpsError(err.code === 1 ? "Location permission was denied." : "Could not get your location."),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [watching]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !you) return;
    if (!youRef.current) {
      const marker = L.marker([you.lat, you.lng], { icon: youIcon(), zIndexOffset: 2000 })
        .bindTooltip("You", { permanent: true, className: "map-label", direction: "right", offset: [12, 0] })
        .addTo(map);
      const circle = L.circle([you.lat, you.lng], { radius: you.accuracy, color: INK, weight: 1, dashArray: "4 4", fill: false }).addTo(map);
      youRef.current = { marker, circle };
      if (!target) map.setView([you.lat, you.lng], 18);
    } else {
      youRef.current.marker.setLatLng([you.lat, you.lng]);
      youRef.current.circle.setLatLng([you.lat, you.lng]).setRadius(you.accuracy);
    }
  }, [you, target]);

  const toggle = (c: PoiCategory) =>
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const meters = you && target ? Math.round(distanceM(you, target)) : null;
  const chip = (on: boolean) =>
    `inline-flex min-h-12 items-center gap-1 rounded-xl px-3 font-semibold ${on ? "border-[3px] border-ink bg-paper" : "border border-line bg-paper text-muted"}`;

  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const gate = findGate(pois, query);
          setTarget(gate);
          if (!gate) setGpsError(`Gate ${query} is not on the map for this airport.`);
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Gate, e.g. F7"
          aria-label="Find a gate"
          className="min-h-12 w-full rounded-xl border-2 border-line bg-paper px-3 text-lg"
        />
        <button className="min-h-12 rounded-xl bg-accent px-5 font-bold text-white">Find</button>
      </form>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Show on map">
        {(Object.keys(CATEGORY) as PoiCategory[])
          .filter((c) => counts.get(c))
          .map((c) => (
            <button key={c} type="button" aria-pressed={visible.has(c)} className={chip(visible.has(c))} onClick={() => toggle(c)}>
              {visible.has(c) ? "✓ " : ""}
              {CATEGORY[c].label} ({counts.get(c)})
            </button>
          ))}
      </div>

      <div ref={ref} className="h-[60vh] min-h-96 w-full overflow-hidden rounded-2xl border border-line" role="application" aria-label="Airport map" />

      <div className="space-y-2 rounded-2xl border border-line bg-paper p-4">
        <button type="button" className={chip(watching)} aria-pressed={watching} onClick={() => setWatching((w) => !w)}>
          {watching ? "Showing my location" : "Show my location"}
        </button>
        {target ? (
          <p className="text-lg font-semibold">
            {target.category === "gate" ? `Gate ${target.ref}` : target.name ?? CATEGORY[target.category].label}
            {target.level ? ` (level ${target.level})` : ""}
            {meters !== null ? `: about ${meters} m, ${Math.max(1, Math.round(meters / WALK_M_PER_MIN))} min walk in a straight line` : ""}
          </p>
        ) : (
          <p className="text-muted">Tap a marker or search a gate to see how far it is.</p>
        )}
        {you && you.accuracy > 50 ? <p className="text-sm text-muted">Indoor GPS is approximate (about {Math.round(you.accuracy)} m).</p> : null}
        {gpsError ? (
          <p role="alert" className="font-semibold">
            {gpsError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
