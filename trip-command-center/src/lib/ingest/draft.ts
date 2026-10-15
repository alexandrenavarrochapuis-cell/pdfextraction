// Drafts are segments straight out of JSON-LD or Claude: times are still
// strings (with or without an offset) and zones may be missing. finalizeDraft
// pins every place to a zone and coordinates and converts times to UTC.

import type { ExtractedSegment, Place, SegmentDetails, SegmentType } from "../types";
import { lookupAirport } from "../airports";
import { isValidTimeZone, resolveInstant } from "../time";
import { REVIEW_CONFIDENCE_THRESHOLD } from "../config";

export interface DraftSegment {
  type: SegmentType;
  action: "confirmed" | "cancelled";
  confirmation_code: string | null;
  provider: string | null;
  /** "2026-06-24T18:05", "2026-06-24T18:05:00+02:00" or "2026-06-24". */
  start_local: string | null;
  start_tz: string | null;
  end_local: string | null;
  end_tz: string | null;
  origin: Place | null;
  destination: Place | null;
  details: SegmentDetails;
  confidence: number;
}

export interface GeoResult {
  name: string;
  country: string | null;
  /** State or region, e.g. "Florida". */
  region?: string | null;
  lat: number;
  lng: number;
  tz: string;
}

export type Geocoder = (city: string, country?: string | null) => Promise<GeoResult | null>;

const DETAIL_KEYS: Record<SegmentType, (keyof SegmentDetails)[]> = {
  flight: [
    "flight_number",
    "airline",
    "departure_terminal",
    "departure_gate",
    "arrival_terminal",
    "seat",
    "cabin",
    "record_locator",
    "check_in_url",
    "passenger_names",
  ],
  train: ["seat", "cabin", "check_in_url", "passenger_names", "departure_terminal"],
  hotel: [
    "property_name",
    "address",
    "phone",
    "check_in_time",
    "check_out_time",
    "room_type",
    "cancellation_deadline",
    "check_in_instructions",
    "rate_per_night",
    "currency",
  ],
  car: [
    "company",
    "pickup_location",
    "dropoff_location",
    "reservation_number",
    "vehicle_class",
    "pickup_hours",
    "phone",
  ],
  event: ["address", "phone", "note"],
  other: ["address", "phone", "note"],
  drive: ["stops", "vehicle", "ends_at_home", "note"],
  stop: ["stop_kind", "address", "phone", "note", "place_id"],
};

/** Keep only the detail keys that belong to the segment type, dropping empties. */
export function pruneDetails(type: SegmentType, details: SegmentDetails): SegmentDetails {
  const out: SegmentDetails = {};
  for (const key of DETAIL_KEYS[type]) {
    const value = details[key];
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

function cleanPlace(place: Place | null): Place | null {
  if (!place) return null;
  const out: Place = {};
  for (const [k, v] of Object.entries(place)) {
    if (v !== null && v !== undefined && v !== "") (out as Record<string, unknown>)[k] = v;
  }
  if (out.code) out.code = out.code.toUpperCase();
  return Object.keys(out).length ? out : null;
}

/** Fill city, country, coordinates (and return the zone) from the airport table or a geocoder. */
async function enrichPlace(
  place: Place | null,
  geocode: Geocoder,
): Promise<{ place: Place | null; tz: string | null }> {
  if (!place) return { place: null, tz: null };
  const airport = lookupAirport(place.code);
  if (airport) {
    return {
      place: {
        ...place,
        name: place.name ?? airport.name,
        city: place.city ?? airport.city,
        country: place.country ?? airport.country,
        lat: place.lat ?? airport.lat,
        lng: place.lng ?? airport.lng,
      },
      tz: airport.tz,
    };
  }
  if (place.city) {
    const geo = await geocode(place.city, place.country);
    if (geo) {
      return {
        place: {
          ...place,
          country: place.country ?? geo.country,
          lat: place.lat ?? geo.lat,
          lng: place.lng ?? geo.lng,
        },
        tz: geo.tz,
      };
    }
  }
  return { place, tz: null };
}

/** Where the start and end of each segment type happen. */
function anchors(type: SegmentType): { start: "origin" | "destination"; end: "origin" | "destination" } {
  switch (type) {
    case "flight":
    case "train":
    case "car":
    case "drive":
      return { start: "origin", end: "destination" };
    default:
      // hotel, event and stop: the single place is stored as the destination
      return { start: "destination", end: "destination" };
  }
}

export function requiredMissing(seg: ExtractedSegment): string[] {
  const missing: string[] = [];
  if (seg.action === "cancelled") {
    if (!seg.confirmation_code) missing.push("confirmation code");
    return missing;
  }
  if (!seg.start_at) missing.push("start time");
  if (!seg.start_tz) missing.push("start time zone");
  switch (seg.type) {
    case "flight":
      if (!seg.origin?.code && !seg.origin?.city) missing.push("departure airport");
      if (!seg.destination?.code && !seg.destination?.city) missing.push("arrival airport");
      if (!seg.details.flight_number) missing.push("flight number");
      if (!seg.end_at) missing.push("arrival time");
      break;
    case "hotel":
      if (!seg.end_at) missing.push("check-out date");
      if (!seg.destination?.city && !seg.details.address) missing.push("hotel location");
      break;
    case "car":
      if (!seg.origin?.city && !seg.details.pickup_location) missing.push("pickup location");
      break;
    case "drive":
      if (!seg.origin?.address && !seg.origin?.city) missing.push("starting address");
      if (!seg.destination?.address && !seg.destination?.city) missing.push("destination address");
      break;
    case "stop":
      if (!seg.destination?.address && !seg.destination?.city) missing.push("location");
      break;
    default:
      break;
  }
  return missing;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "3:00 PM", "3 pm", "15:00" or "15h00" to "15:00". */
export function parseClock(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /(\d{1,2})(?:[:h.](\d{2}))?\s*([ap])\.?\s?m\.?(?![a-z])/i.exec(value) ?? /(\d{1,2})[:h](\d{2})/.exec(value);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  const meridiem = m[3]?.toLowerCase();
  if (meridiem === "p" && hour < 12) hour += 12;
  if (meridiem === "a" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function withTime(local: string | null, clock: string): string | null {
  if (!local) return null;
  return DATE_ONLY_RE.test(local.trim()) ? `${local.trim()}T${clock}` : local;
}

export async function finalizeDraft(draft: DraftSegment, geocode: Geocoder): Promise<ExtractedSegment> {
  const { start: startAnchor, end: endAnchor } = anchors(draft.type);
  const origin = await enrichPlace(cleanPlace(draft.origin), geocode);
  const destination = await enrichPlace(cleanPlace(draft.destination), geocode);
  const zoneOf = (anchor: "origin" | "destination") => (anchor === "origin" ? origin.tz : destination.tz);

  // Trust the airport table or geocoder over a model-supplied zone.
  const startTz =
    zoneOf(startAnchor) ?? (isValidTimeZone(draft.start_tz) ? draft.start_tz : null);
  const endTz =
    zoneOf(endAnchor) ??
    (isValidTimeZone(draft.end_tz) ? draft.end_tz : null) ??
    (draft.type === "car" || draft.type === "drive" ? startTz : null) ??
    (startAnchor === endAnchor ? startTz : null);

  let startLocal = draft.start_local;
  let endLocal = draft.end_local;
  if (draft.type === "hotel") {
    // Stays often carry dates only; use the stated or customary check-in/out hour.
    startLocal = withTime(startLocal, parseClock(draft.details.check_in_time) ?? "15:00");
    endLocal = withTime(endLocal, parseClock(draft.details.check_out_time) ?? "11:00");
  }
  const startAt = resolveInstant(startLocal, startTz);
  const endAt = resolveInstant(endLocal, endTz);

  const seg: ExtractedSegment = {
    type: draft.type,
    action: draft.action,
    confirmation_code: draft.confirmation_code?.trim() || null,
    provider: draft.provider?.trim() || null,
    start_at: startAt?.toISOString() ?? null,
    start_tz: startTz,
    end_at: endAt?.toISOString() ?? null,
    end_tz: endTz,
    origin: origin.place,
    destination: destination.place,
    details: pruneDetails(draft.type, draft.details),
    confidence: Math.min(1, Math.max(0, draft.confidence)),
    review_reasons: [],
  };

  seg.review_reasons = computeReviewReasons(seg);
  return seg;
}

/** Why a segment needs a human look; empty when it can go straight on the timeline. */
export function computeReviewReasons(seg: ExtractedSegment): string[] {
  const reasons = requiredMissing(seg).map((f) => `missing ${f}`);
  if (seg.end_at && seg.start_at && Date.parse(seg.end_at) < Date.parse(seg.start_at)) {
    reasons.push("ends before it starts");
  }
  if (seg.confidence < REVIEW_CONFIDENCE_THRESHOLD) reasons.push("low extraction confidence");
  return reasons;
}
