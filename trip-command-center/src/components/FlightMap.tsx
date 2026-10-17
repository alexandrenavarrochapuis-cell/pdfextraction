"use client";

// Leaflet map for one flight. Shapes and text labels carry the meaning, not
// color: departure is a circle, arrival a square, your plane a filled plane,
// the inbound aircraft an outlined plane; the flown part of the route is a
// solid line and the rest dashed.

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import type { MapPlane, TrackView } from "@/lib/flight/view";
import { greatCirclePath, type LatLng } from "@/lib/flight/track";

const INK = "#1b1b1f";
const PLANE_PATH =
  "M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z";

function planeIcon(heading: number, outlined: boolean): L.DivIcon {
  // The glyph points north-east, so rotate by heading minus 45 degrees.
  const fill = outlined ? "#ffffff" : INK;
  const html = `<svg width="36" height="36" viewBox="0 0 24 24" style="transform: rotate(${heading - 45}deg)">
    <path d="${PLANE_PATH}" fill="${fill}" stroke="${INK}" stroke-width="${outlined ? 1.6 : 1}" stroke-linejoin="round"/>
  </svg>`;
  return L.divIcon({ html, className: "plane-icon", iconSize: [36, 36], iconAnchor: [18, 18] });
}

function airportIcon(shape: "circle" | "square" | "triangle"): L.DivIcon {
  const shapes = {
    circle: `<circle cx="9" cy="9" r="7" fill="#fff" stroke="${INK}" stroke-width="3"/>`,
    square: `<rect x="2" y="2" width="14" height="14" fill="${INK}" stroke="${INK}" stroke-width="2"/>`,
    triangle: `<path d="M9 2 16 16H2Z" fill="#fff" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`,
  };
  return L.divIcon({
    html: `<svg width="18" height="18" viewBox="0 0 18 18">${shapes[shape]}</svg>`,
    className: "plane-icon",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function label(marker: L.Marker, text: string, direction: L.Direction = "top") {
  marker.bindTooltip(text, { permanent: true, direction, className: "map-label", offset: [0, -10] });
}

const toLatLngs = (pts: LatLng[]): L.LatLngExpression[] => pts.map((p) => [p.lat, p.lng]);

/** Shift a point by whole turns of longitude so it sits next to a reference line. */
function nearLng(p: LatLng, ref: LatLng): LatLng {
  let lng = p.lng;
  while (lng - ref.lng > 180) lng -= 360;
  while (lng - ref.lng < -180) lng += 360;
  return { lat: p.lat, lng };
}

function planeLabel(plane: MapPlane, name: string): string {
  return plane.source === "live" ? name : `${name} (estimated)`;
}

export default function FlightMap({ view }: { view: TrackView }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const map = L.map(container.current, { worldCopyJump: true, zoomControl: true, attributionControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 12,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      fittedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const route = greatCirclePath(view.origin, view.destination);
    const bounds: L.LatLngExpression[] = toLatLngs(route);

    // Planned route, dashed.
    L.polyline(toLatLngs(route), { color: INK, weight: 3, dashArray: "8 8", opacity: 0.8 }).addTo(layer);

    const dep = L.marker([view.origin.lat, view.origin.lng], { icon: airportIcon("circle"), keyboard: false }).addTo(layer);
    label(dep, `Depart ${view.origin.code ?? view.origin.label}`, "left");
    const end = route[route.length - 1];
    const arr = L.marker([end.lat, end.lng], { icon: airportIcon("square"), keyboard: false }).addTo(layer);
    label(arr, `Arrive ${view.destination.code ?? view.destination.label}`, "right");

    if (view.plane) {
      const plane = nearLng(view.plane, route[0]);
      // Flown part, solid.
      const flown = greatCirclePath(view.origin, plane, 32);
      L.polyline(toLatLngs(flown), { color: INK, weight: 4 }).addTo(layer);
      const m = L.marker([plane.lat, plane.lng], {
        icon: planeIcon(view.plane.heading, false),
        zIndexOffset: 1000,
        title: "Your flight",
      }).addTo(layer);
      label(m, planeLabel(view.plane, view.flight_number ?? "Your flight"), "bottom");
      bounds.push([plane.lat, plane.lng]);
    }

    if (view.inbound) {
      const ib = view.inbound;
      if (ib.origin) {
        const ibRoute = greatCirclePath(ib.origin, view.origin).map((p) => nearLng(p, route[0]));
        L.polyline(toLatLngs(ibRoute), { color: INK, weight: 2, dashArray: "2 6" }).addTo(layer);
        const o = ibRoute[0];
        const om = L.marker([o.lat, o.lng], { icon: airportIcon("triangle"), keyboard: false }).addTo(layer);
        label(om, `Inbound from ${ib.origin.code ?? ib.origin.label}`, "left");
        bounds.push(...toLatLngs(ibRoute));
      }
      if (ib.plane) {
        const p = nearLng(ib.plane, route[0]);
        const m = L.marker([p.lat, p.lng], { icon: planeIcon(ib.plane.heading, true), title: "Inbound aircraft" }).addTo(layer);
        label(m, planeLabel(ib.plane, `Inbound ${ib.ident}`), "bottom");
        bounds.push([p.lat, p.lng]);
      }
    }

    // Fit once; later refreshes keep whatever zoom Alex chose.
    if (!fittedRef.current) {
      map.fitBounds(L.latLngBounds(bounds as L.LatLngTuple[]), { padding: [48, 48] });
      fittedRef.current = true;
    }
  }, [view]);

  return (
    <div
      ref={container}
      className="h-[55vh] min-h-80 w-full overflow-hidden rounded-2xl border border-line"
      role="img"
      aria-label={`Map of ${view.title}`}
    />
  );
}
