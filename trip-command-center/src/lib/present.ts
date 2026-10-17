// Display strings shared by the timeline, review queue, brief and push text.

import type { Place, Segment, SegmentStatus, SegmentType, StopKind } from "./types";

export const TYPE_LABEL: Record<SegmentType, string> = {
  flight: "Flight",
  hotel: "Stay",
  car: "Car rental",
  train: "Train",
  event: "Event",
  other: "Other",
  drive: "Drive",
  stop: "Stop",
};

export const STOP_KIND_LABEL: Record<StopKind, string> = {
  family: "Family",
  friend: "Friends",
  office: "Office",
  meeting: "Meeting",
  visit: "Visit",
};

/** Lodging platform behind a stay, from the provider name. */
export function stayPlatform(seg: Pick<Segment, "provider" | "details">): "booking" | "airbnb" | "vrbo" | "expedia" | null {
  const p = `${seg.provider ?? ""} ${seg.details?.property_name ?? ""}`.toLowerCase();
  if (p.includes("booking.com") || /\bbooking\b/.test(p)) return "booking";
  if (p.includes("airbnb")) return "airbnb";
  if (p.includes("vrbo")) return "vrbo";
  if (p.includes("expedia") || p.includes("hotels.com")) return "expedia";
  return null;
}

export const PLATFORM_MANAGE: Record<NonNullable<ReturnType<typeof stayPlatform>>, { label: string; url: string }> = {
  booking: { label: "Manage on Booking.com", url: "https://secure.booking.com/myreservations.html" },
  airbnb: { label: "Open in Airbnb", url: "https://www.airbnb.com/trips" },
  vrbo: { label: "Open in Vrbo", url: "https://www.vrbo.com/traveler/th/bookings" },
  expedia: { label: "Open in Expedia", url: "https://www.expedia.com/trips" },
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
    case "drive": {
      const from = seg.origin?.name ?? seg.origin?.city;
      const to = seg.destination?.name ?? seg.destination?.city;
      const stops = d.stops?.length ? ` · ${d.stops.length} stop${d.stops.length === 1 ? "" : "s"}` : "";
      return `${from ?? "Start"} → ${to ?? "Destination"}${stops}`;
    }
    case "stop":
      return [d.stop_kind ? STOP_KIND_LABEL[d.stop_kind] : null, seg.destination?.name ?? d.note ?? seg.destination?.city]
        .filter(Boolean)
        .join(" · ") || "Stop";
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
    case "drive":
      return seg.destination?.address ?? seg.destination?.name ?? null;
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

function placeQuery(p: Place): string {
  return p.address ?? ([p.name, p.city].filter(Boolean).join(", ") || (p.lat != null ? `${p.lat},${p.lng}` : ""));
}

/**
 * Google Maps turn-by-turn directions through every stop (Maps URLs, no key).
 * On iPhone this opens the Google Maps app when it is installed.
 * https://developers.google.com/maps/documentation/urls/get-started
 */
export function googleDirectionsUrl(origin: Place | null, destination: Place, stops: Place[] = []): string {
  const params = new URLSearchParams({ api: "1", destination: placeQuery(destination), travelmode: "driving" });
  if (origin) params.set("origin", placeQuery(origin));
  if (stops.length) params.set("waypoints", stops.map(placeQuery).join("|"));
  return `https://www.google.com/maps/dir/?${params}`;
}

export function appleDirectionsUrl(origin: Place | null, destination: Place): string {
  const params = new URLSearchParams({ daddr: placeQuery(destination), dirflg: "d" });
  if (origin) params.set("saddr", placeQuery(origin));
  return `https://maps.apple.com/?${params}`;
}

export function wazeUrl(destination: Place): string {
  if (destination.lat != null && destination.lng != null) {
    return `https://waze.com/ul?ll=${destination.lat},${destination.lng}&navigate=yes`;
  }
  return `https://waze.com/ul?q=${encodeURIComponent(placeQuery(destination))}&navigate=yes`;
}

export function placeText(p: Place): string {
  return placeQuery(p);
}
