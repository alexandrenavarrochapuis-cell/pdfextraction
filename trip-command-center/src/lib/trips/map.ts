// What the whole-trip map draws: a line per flight, train and drive, and a
// marker per airport, stay, stop, rental and event, each with a Google Maps link.

import type { Place, Segment } from "../types";

export type LineKind = "flight" | "train" | "drive";
export type MarkerKind = "airport" | "stay" | "stop" | "car" | "event" | "place";

export interface MapLine {
  kind: LineKind;
  points: [number, number][];
  label: string;
}

export interface MapMarker {
  lat: number;
  lng: number;
  kind: MarkerKind;
  label: string;
  detail: string | null;
  href: string;
}

export interface TripMapData {
  lines: MapLine[];
  markers: MapMarker[];
  driveIds: string[];
}

function located(p: Place | null | undefined): p is Place & { lat: number; lng: number } {
  return p?.lat != null && p?.lng != null;
}

function googleMapsLink(p: Place & { lat: number; lng: number }): string {
  const query = p.address ?? ([p.name, p.city].filter(Boolean).join(", ") || `${p.lat},${p.lng}`);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function tripMapData(segments: Segment[]): TripMapData {
  const lines: MapLine[] = [];
  const markers = new Map<string, MapMarker>();
  const driveIds: string[] = [];
  const mark = (p: Place | null | undefined, kind: MarkerKind, label: string) => {
    if (!located(p)) return;
    const key = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
    if (markers.has(key)) return;
    const detail = p.address ?? (p.city && p.city !== label ? p.city : null);
    markers.set(key, { lat: p.lat, lng: p.lng, kind, label, detail, href: googleMapsLink(p) });
  };

  for (const s of segments) {
    if (s.status === "cancelled") continue;
    switch (s.type) {
      case "flight":
      case "train": {
        const kind: MarkerKind = s.type === "flight" ? "airport" : "place";
        mark(s.origin, kind, s.origin?.code ?? s.origin?.name ?? s.origin?.city ?? "Departure");
        mark(s.destination, kind, s.destination?.code ?? s.destination?.name ?? s.destination?.city ?? "Arrival");
        if (located(s.origin) && located(s.destination)) {
          const number = s.details?.flight_number ?? s.provider ?? "";
          lines.push({
            kind: s.type,
            points: [
              [s.origin.lat, s.origin.lng],
              [s.destination.lat, s.destination.lng],
            ],
            label: `${s.type === "flight" ? "Flight" : "Train"} ${number}`.trim(),
          });
        }
        break;
      }
      case "drive": {
        const stops = s.details?.stops ?? [];
        mark(s.origin, "place", s.origin?.name ?? s.origin?.city ?? "Start");
        stops.forEach((p, i) => mark(p, "stop", p.name ?? p.city ?? `Stop ${i + 1}`));
        mark(s.destination, "place", s.destination?.name ?? s.destination?.city ?? "Destination");
        const points = [s.origin, ...stops, s.destination].filter(located).map((p) => [p.lat, p.lng] as [number, number]);
        if (points.length >= 2) {
          lines.push({ kind: "drive", points, label: `Drive${s.details?.vehicle ? ` (${s.details.vehicle})` : ""}` });
          driveIds.push(s.id);
        }
        break;
      }
      case "car":
        mark(s.origin, "car", s.provider ? `${s.provider} pickup` : "Car pickup");
        break;
      case "hotel":
        mark(s.destination, "stay", s.details?.property_name ?? s.provider ?? s.destination?.name ?? "Stay");
        break;
      case "stop":
        mark(s.destination, "stop", s.destination?.name ?? "Stop");
        break;
      default:
        mark(s.destination, "event", s.details?.note ?? s.destination?.name ?? "Event");
    }
  }
  return { lines, markers: [...markers.values()], driveIds };
}
