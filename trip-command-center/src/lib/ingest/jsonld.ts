// schema.org reservation markup (spec section 3, step 5a). Airlines, hotel
// chains and booking sites embed it in confirmation emails so Gmail can build
// its own cards; when present it beats free-text extraction.
// https://developers.google.com/workspace/gmail/markup/reference/types

import type { Place, SegmentType } from "../types";
import type { DraftSegment } from "./draft";
import { extractJsonLdBlocks } from "./html";

type Obj = Record<string, unknown>;

const JSONLD_CONFIDENCE = 0.95;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function typeNames(o: Obj): string[] {
  const t = o["@type"];
  const list = Array.isArray(t) ? t : [t];
  return list.filter((x): x is string => typeof x === "string").map((x) => x.replace(/^.*[/#]/, ""));
}

function str(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (isObj(v)) return str(v.name) ?? str(v["@id"]);
  if (Array.isArray(v)) return str(v[0]);
  return null;
}

function obj(v: unknown): Obj | null {
  if (isObj(v)) return v;
  if (Array.isArray(v) && isObj(v[0])) return v[0];
  return null;
}

/** Walk parsed JSON-LD (arrays, @graph, nesting) collecting reservation objects. */
function collectReservations(node: unknown, out: Obj[]) {
  if (Array.isArray(node)) {
    for (const n of node) collectReservations(n, out);
    return;
  }
  if (!isObj(node)) return;
  if (typeNames(node).some((t) => t.endsWith("Reservation"))) out.push(node);
  if (node["@graph"]) collectReservations(node["@graph"], out);
}

function countryCode(v: unknown): string | null {
  const c = str(v);
  if (!c) return null;
  return /^[A-Za-z]{2}$/.test(c) ? c.toUpperCase() : c;
}

function formatAddress(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  const a = obj(v);
  if (!a) return null;
  const locality = [str(a.addressLocality), [str(a.addressRegion), str(a.postalCode)].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [str(a.streetAddress), locality, str(a.addressCountry)].filter(Boolean).join(", ") || null;
}

function placeFrom(v: unknown): Place | null {
  const p = obj(v);
  if (!p) return null;
  const address = obj(p.address);
  return {
    name: str(p.name),
    code: str(p.iataCode),
    city: address ? str(address.addressLocality) : null,
    country: address ? countryCode(address.addressCountry) : null,
    address: formatAddress(p.address),
    lat: typeof p.latitude === "number" ? p.latitude : null,
    lng: typeof p.longitude === "number" ? p.longitude : null,
  };
}

function statusOf(o: Obj): "confirmed" | "cancelled" {
  const s = str(o.reservationStatus) ?? "";
  return /cancel/i.test(s) ? "cancelled" : "confirmed";
}

function flightNumber(flight: Obj): string | null {
  const num = str(flight.flightNumber);
  if (!num) return null;
  const airline = obj(flight.airline);
  const iata = airline ? str(airline.iataCode) : null;
  return /^\d+$/.test(num) && iata ? `${iata} ${num}` : num;
}

function base(type: SegmentType, o: Obj): DraftSegment {
  return {
    type,
    action: statusOf(o),
    confirmation_code: str(o.reservationNumber) ?? str(o.reservationId),
    provider: str(o.provider) ?? str(o.broker),
    start_local: null,
    start_tz: null,
    end_local: null,
    end_tz: null,
    origin: null,
    destination: null,
    details: {},
    confidence: JSONLD_CONFIDENCE,
  };
}

function fromFlight(o: Obj): DraftSegment | null {
  const f = obj(o.reservationFor);
  if (!f) return null;
  const d = base("flight", o);
  const airline = obj(f.airline);
  d.provider = (airline && str(airline.name)) ?? d.provider;
  d.origin = placeFrom(f.departureAirport);
  d.destination = placeFrom(f.arrivalAirport);
  d.start_local = str(f.departureTime);
  d.end_local = str(f.arrivalTime);
  const passenger = str(o.underName);
  d.details = {
    flight_number: flightNumber(f),
    airline: airline ? str(airline.name) : null,
    departure_terminal: str(f.departureTerminal),
    departure_gate: str(f.departureGate),
    arrival_terminal: str(f.arrivalTerminal),
    seat: str(o.airplaneSeat),
    cabin: str(o.airplaneSeatClass),
    record_locator: d.confirmation_code,
    check_in_url: str(o.checkinUrl) ?? str(o.checkInUrl),
    passenger_names: passenger ? [passenger] : null,
  };
  return d;
}

function fromLodging(o: Obj): DraftSegment | null {
  const h = obj(o.reservationFor);
  if (!h) return null;
  const d = base("hotel", o);
  d.provider = str(h.brand) ?? str(h.name) ?? d.provider;
  d.destination = placeFrom(h);
  d.start_local = str(o.checkinTime) ?? str(o.checkinDate);
  d.end_local = str(o.checkoutTime) ?? str(o.checkoutDate);
  d.details = {
    property_name: str(h.name),
    address: formatAddress(h.address),
    phone: str(h.telephone),
    room_type: str(o.lodgingUnitDescription) ?? str(o.lodgingUnitType),
  };
  return d;
}

function fromRentalCar(o: Obj): DraftSegment | null {
  const car = obj(o.reservationFor);
  const d = base("car", o);
  const company = car ? str(car.rentalCompany) : null;
  d.provider = company ?? d.provider;
  d.origin = placeFrom(o.pickupLocation);
  d.destination = placeFrom(o.dropoffLocation);
  d.start_local = str(o.pickupTime);
  d.end_local = str(o.dropoffTime);
  const model = car ? [str(car.brand), str(car.model)].filter(Boolean).join(" ") : "";
  const vehicle = car ? [str(car.name), model ? `(${model})` : ""].filter(Boolean).join(" ") : "";
  d.details = {
    company: company ?? d.provider,
    pickup_location: d.origin?.address ?? d.origin?.name ?? null,
    dropoff_location: d.destination?.address ?? d.destination?.name ?? null,
    reservation_number: d.confirmation_code,
    vehicle_class: vehicle || null,
    phone: d.origin ? str(obj(o.pickupLocation)?.telephone) : null,
  };
  return d;
}

function fromTrain(o: Obj): DraftSegment | null {
  const t = obj(o.reservationFor);
  if (!t) return null;
  const d = base("train", o);
  d.provider = str(t.provider) ?? d.provider;
  d.origin = placeFrom(t.departureStation);
  d.destination = placeFrom(t.arrivalStation);
  d.start_local = str(t.departureTime);
  d.end_local = str(t.arrivalTime);
  const passenger = str(o.underName);
  d.details = {
    seat: str(obj(o.reservedTicket)?.ticketedSeat),
    passenger_names: passenger ? [passenger] : null,
  };
  return d;
}

function fromEvent(o: Obj): DraftSegment | null {
  const e = obj(o.reservationFor);
  if (!e) return null;
  const d = base("event", o);
  d.provider = str(e.name) ?? d.provider;
  d.destination = placeFrom(e.location);
  d.start_local = str(e.startDate);
  d.end_local = str(e.endDate);
  d.details = { address: d.destination?.address ?? null, note: str(e.name) };
  return d;
}

const BUILDERS: Record<string, (o: Obj) => DraftSegment | null> = {
  FlightReservation: fromFlight,
  LodgingReservation: fromLodging,
  RentalCarReservation: fromRentalCar,
  TrainReservation: fromTrain,
  EventReservation: fromEvent,
};

/** Passengers on one booking get one reservation object each; fold them into one leg. */
function mergeFlights(drafts: DraftSegment[]): DraftSegment[] {
  const out: DraftSegment[] = [];
  const byLeg = new Map<string, DraftSegment>();
  for (const d of drafts) {
    if (d.type !== "flight") {
      out.push(d);
      continue;
    }
    const key = [d.confirmation_code, d.details.flight_number, d.start_local].join("|");
    const prev = byLeg.get(key);
    if (!prev) {
      byLeg.set(key, d);
      out.push(d);
      continue;
    }
    const names = new Set([...(prev.details.passenger_names ?? []), ...(d.details.passenger_names ?? [])]);
    prev.details.passenger_names = [...names];
    const seats = [prev.details.seat, d.details.seat].filter(Boolean);
    prev.details.seat = seats.length ? [...new Set(seats)].join(", ") : null;
  }
  return out;
}

export function parseJsonLdReservations(html: string | null | undefined): DraftSegment[] {
  if (!html) return [];
  const reservations: Obj[] = [];
  for (const block of extractJsonLdBlocks(html)) {
    try {
      collectReservations(JSON.parse(block), reservations);
    } catch {
      // Malformed markup is common; the Claude path still covers the email.
    }
  }
  const drafts: DraftSegment[] = [];
  for (const r of reservations) {
    const type = typeNames(r).find((t) => BUILDERS[t]);
    const draft = type ? BUILDERS[type](r) : null;
    if (draft) drafts.push(draft);
  }
  return mergeFlights(drafts);
}
