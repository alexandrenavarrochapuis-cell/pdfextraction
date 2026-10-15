// Shared domain types. Mirrors supabase/migrations/0001_init.sql.

export const SEGMENT_TYPES = [
  "flight",
  "hotel",
  "car", // rental car
  "train",
  "event",
  "other",
  "drive", // road trip in your own car
  "stop", // family, friends, office, in-person meeting
] as const;
export type SegmentType = (typeof SEGMENT_TYPES)[number];

export const SEGMENT_STATUSES = ["confirmed", "cancelled", "needs_review"] as const;
export type SegmentStatus = (typeof SEGMENT_STATUSES)[number];

export type TripStatus = "upcoming" | "active" | "past";

export interface Place {
  name?: string | null;
  code?: string | null; // IATA code for airports and stations
  city?: string | null;
  country?: string | null; // ISO 3166-1 alpha-2 when known
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
}

/** Type-specific fields (spec section 5). Only keys relevant to the type are kept. */
export interface SegmentDetails {
  // flight
  flight_number?: string | null;
  airline?: string | null;
  departure_terminal?: string | null;
  departure_gate?: string | null;
  arrival_terminal?: string | null;
  seat?: string | null;
  cabin?: string | null;
  record_locator?: string | null;
  check_in_url?: string | null;
  passenger_names?: string[] | null;
  // hotel
  property_name?: string | null;
  address?: string | null;
  phone?: string | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
  room_type?: string | null;
  cancellation_deadline?: string | null;
  // car
  company?: string | null;
  pickup_location?: string | null;
  dropoff_location?: string | null;
  reservation_number?: string | null;
  vehicle_class?: string | null;
  pickup_hours?: string | null;
  // hotel, Booking.com, Airbnb, Vrbo
  check_in_instructions?: string | null;
  rate_per_night?: number | null;
  currency?: string | null;
  // drive
  stops?: Place[] | null;
  vehicle?: string | null;
  ends_at_home?: boolean | null;
  // stop
  stop_kind?: StopKind | null;
  place_id?: string | null;
  // fallback
  note?: string | null;
}

export const STOP_KINDS = ["family", "friend", "office", "meeting", "visit"] as const;
export type StopKind = (typeof STOP_KINDS)[number];

export const PLACE_KINDS = ["home", "family", "friend", "office", "other"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export interface SavedPlace {
  id: string;
  user_id: string;
  label: string;
  kind: PlaceKind;
  address: string;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  tz: string | null;
}

export interface Segment {
  id: string;
  user_id: string;
  trip_id: string | null;
  type: SegmentType;
  status: SegmentStatus;
  confirmation_code: string | null;
  provider: string | null;
  start_at: string | null; // ISO UTC
  start_tz: string | null; // IANA zone of the start location
  end_at: string | null;
  end_tz: string | null;
  origin: Place | null;
  destination: Place | null;
  details: SegmentDetails;
  source_email_id: string | null;
  confidence: number | null;
  review_reasons: string[];
  created_at?: string;
  updated_at?: string;
}

export interface Trip {
  id: string;
  user_id: string;
  title: string;
  title_locked: boolean;
  grouping_locked: boolean;
  start_at: string | null;
  end_at: string | null;
  primary_city: string | null;
  status: TripStatus;
  created_at?: string;
  updated_at?: string;
}

export interface RawEmail {
  id: string;
  user_id: string;
  provider_email_id: string | null;
  message_id: string | null;
  received_at: string;
  from_addr: string | null;
  to_addrs: string[] | null;
  subject: string | null;
  headers: Record<string, string> | null;
  body_text: string | null;
  body_html: string | null;
  attachments: StoredAttachment[];
  processing_status: "received" | "processed" | "ignored" | "failed";
  processing_error: string | null;
  extraction_method: "jsonld" | "claude" | null;
}

export interface StoredAttachment {
  id: string;
  filename: string | null;
  content_type: string;
  size: number | null;
  storage_path: string | null;
}

export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  created_at: string;
}

export interface Profile {
  id: string;
  email: string;
  brief_hour: number;
  push_enabled: boolean;
}

/**
 * A segment as produced by extraction, before it is matched against the
 * database. Times are already resolved to UTC.
 */
export interface ExtractedSegment {
  type: SegmentType;
  /** Whether the email confirms or cancels this segment. */
  action: "confirmed" | "cancelled";
  confirmation_code: string | null;
  provider: string | null;
  start_at: string | null;
  start_tz: string | null;
  end_at: string | null;
  end_tz: string | null;
  origin: Place | null;
  destination: Place | null;
  details: SegmentDetails;
  confidence: number;
  review_reasons: string[];
}

export interface Traveler {
  id: string;
  user_id: string;
  name: string;
  relation: "self" | "spouse" | "child" | "parent" | "other";
  name_variants: string[];
}

export interface BoardingPass {
  id: string;
  user_id: string;
  segment_id: string | null;
  traveler_id: string | null;
  passenger_name: string | null;
  kind: "wallet" | "pdf" | "image" | "barcode";
  storage_path: string | null;
  content_type: string | null;
  barcode_message: string | null;
  barcode_format: string | null;
  carrier: string | null;
  flight_number: string | null;
  flight_date: string | null;
  origin: string | null;
  destination: string | null;
  seat: string | null;
  boarding_group: string | null;
  boarding_time: string | null;
  gate: string | null;
  source_email_id: string | null;
  created_at: string;
}

export const DOCUMENT_KINDS = ["passport", "national_id", "drivers_license", "trusted_traveler", "visa", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export interface TravelDocument {
  id: string;
  user_id: string;
  traveler_id: string | null;
  kind: DocumentKind;
  label: string | null;
  issuing_country: string | null;
  expires_on: string | null;
  ciphertext: string | null;
  iv: string | null;
  scan_path: string | null;
  scan_iv: string | null;
  scan_type: string | null;
  created_at: string;
}
