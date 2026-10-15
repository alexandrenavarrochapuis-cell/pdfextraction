// Display strings shared by the timeline, review queue, brief and push text.

import type { Place, Segment, SegmentStatus, SegmentType } from "./types";

export const TYPE_LABEL: Record<SegmentType, string> = {
  flight: "Flight",
  hotel: "Hotel",
  car: "Car rental",
  train: "Train",
  event: "Event",
  other: "Other",
};

export const STATUS_LABEL: Record<SegmentStatus, string> = {
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  needs_review: "Review",
};

export function placeShort(place: Place | null | undefined): string | null {
  if (!place) return null;
  return place.code ?? place.city ?? place.name ?? null;
}

export function placeLong(place: Place | null | undefined): string | null {
  if (!place) return null;
  const name = place.name ?? place.city;
  if (place.code && name) return `${place.code} · ${name}`;
  return place.code ?? name ?? place.address ?? null;
}

export function route(seg: Pick<Segment, "origin" | "destination">): string | null {
  const from = placeShort(seg.origin);
  const to = placeShort(seg.destination);
  return from && to ? `${from} → ${to}` : from ?? to;
}

export function segmentTitle(seg: Segment): string {
  const d = seg.details ?? {};
  switch (seg.type) {
    case "flight":
      return [d.flight_number ?? seg.provider ?? "Flight", route(seg)].filter(Boolean).join(" · ");
    case "train":
      return [seg.provider ?? "Train", route(seg)].filter(Boolean).join(" · ");
    case "hotel":
      return d.property_name ?? seg.destination?.name ?? seg.provider ?? "Hotel";
    case "car":
      return [d.company ?? seg.provider ?? "Car rental", seg.origin?.city ?? seg.origin?.code]
        .filter(Boolean)
        .join(" · ");
    default:
      return d.note ?? seg.provider ?? seg.destination?.name ?? TYPE_LABEL[seg.type];
  }
}

/** The address to open in Maps for a segment. */
export function segmentAddress(seg: Segment): string | null {
  const d = seg.details ?? {};
  switch (seg.type) {
    case "hotel":
      return d.address ?? seg.destination?.address ?? ([d.property_name, seg.destination?.city].filter(Boolean).join(", ") || null);
    case "car":
      return d.pickup_location ?? seg.origin?.address ?? seg.origin?.name ?? null;
    case "flight":
    case "train":
      return seg.origin?.name ? [seg.origin.name, seg.origin.city].filter(Boolean).join(", ") : null;
    default:
      return d.address ?? seg.destination?.address ?? seg.destination?.name ?? null;
  }
}

export function mapsUrl(query: string): string {
  return `https://maps.apple.com/?q=${encodeURIComponent(query)}`;
}

export function telUrl(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/** "America/New_York" -> "New York" */
export function zoneCity(tz: string): string {
  return tz.split("/").pop()!.replace(/_/g, " ");
}
