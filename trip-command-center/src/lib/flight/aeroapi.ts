// Live flight data from FlightAware AeroAPI v4 (optional; set FLIGHTAWARE_API_KEY).
// https://www.flightaware.com/aeroapi/portal/documentation
//
// Field names follow the AeroAPI v4 flight object as documented when this was
// written. They have not been exercised against a live key from this repo, so
// every field is read defensively and anything missing simply hides that line
// in the UI. Each call is billed per query; the tracker polls every 2 minutes
// and the server caches responses for 90 seconds.

import "server-only";
import { cacheLife } from "next/cache";

const BASE = "https://aeroapi.flightaware.com/aeroapi";

export interface LiveTimes {
  scheduled: string | null;
  estimated: string | null;
  actual: string | null;
}

export interface LivePosition {
  lat: number;
  lng: number;
  altitude_ft: number | null;
  groundspeed_kt: number | null;
  heading: number | null;
  at: string | null;
}

export interface LiveFlight {
  fa_flight_id: string;
  ident: string;
  status: string | null;
  cancelled: boolean;
  diverted: boolean;
  progress_percent: number | null;
  origin: { code: string | null; name: string | null } | null;
  destination: { code: string | null; name: string | null } | null;
  departure: LiveTimes; // gate out
  arrival: LiveTimes; // gate in
  gate_origin: string | null;
  terminal_origin: string | null;
  gate_destination: string | null;
  terminal_destination: string | null;
  baggage_claim: string | null;
  aircraft_type: string | null;
  registration: string | null;
  inbound_fa_flight_id: string | null;
  position: LivePosition | null;
}

export interface LiveTrack {
  flight: LiveFlight;
  /** The aircraft's previous leg, the plane coming in to operate this flight. */
  inbound: LiveFlight | null;
}

type Json = Record<string, unknown>;

const s = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

async function get(path: string, apiKey: string): Promise<Json | null> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "x-apikey": apiKey, accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    console.error(`[aeroapi] ${path} -> ${res.status}`);
    return null;
  }
  return (await res.json()) as Json;
}

function airport(v: unknown): LiveFlight["origin"] {
  if (!v || typeof v !== "object") return null;
  const a = v as Json;
  return { code: s(a.code_iata) ?? s(a.code), name: s(a.name) };
}

function toFlight(f: Json): LiveFlight {
  return {
    fa_flight_id: String(f.fa_flight_id),
    ident: s(f.ident_iata) ?? s(f.ident) ?? "",
    status: s(f.status),
    cancelled: f.cancelled === true,
    diverted: f.diverted === true,
    progress_percent: n(f.progress_percent),
    origin: airport(f.origin),
    destination: airport(f.destination),
    departure: { scheduled: s(f.scheduled_out), estimated: s(f.estimated_out), actual: s(f.actual_out) },
    arrival: { scheduled: s(f.scheduled_in), estimated: s(f.estimated_in), actual: s(f.actual_in) },
    gate_origin: s(f.gate_origin),
    terminal_origin: s(f.terminal_origin),
    gate_destination: s(f.gate_destination),
    terminal_destination: s(f.terminal_destination),
    baggage_claim: s(f.baggage_claim),
    aircraft_type: s(f.aircraft_type),
    registration: s(f.registration),
    inbound_fa_flight_id: s(f.inbound_fa_flight_id),
    position: null,
  };
}

/** Airborne: took off (or pushed back) and has not landed. */
function isAirborne(f: Json): boolean {
  return !!(s(f.actual_off) ?? s(f.actual_out)) && !s(f.actual_on) && !s(f.actual_in);
}

async function position(faFlightId: string, apiKey: string): Promise<LivePosition | null> {
  const data = await get(`/flights/${encodeURIComponent(faFlightId)}/position`, apiKey);
  const p = data?.last_position as Json | undefined;
  const lat = n(p?.latitude);
  const lng = n(p?.longitude);
  if (lat === null || lng === null) return null;
  const altitude = n(p?.altitude);
  return {
    lat,
    lng,
    // AeroAPI reports altitude in hundreds of feet.
    altitude_ft: altitude === null ? null : altitude * 100,
    groundspeed_kt: n(p?.groundspeed),
    heading: n(p?.heading),
    at: s(p?.timestamp),
  };
}

async function flightsFor(
  ident: string,
  apiKey: string,
  identType: "designator" | "fa_flight_id",
  startIso?: string,
  endIso?: string,
): Promise<Json[]> {
  const params = new URLSearchParams({ ident_type: identType });
  if (startIso) params.set("start", startIso);
  if (endIso) params.set("end", endIso);
  const data = await get(`/flights/${encodeURIComponent(ident)}?${params}`, apiKey);
  return Array.isArray(data?.flights) ? (data!.flights as Json[]) : [];
}

/**
 * The flight matching `ident` closest to the scheduled departure, its live
 * position when airborne, and the inbound aircraft until this flight leaves
 * the gate.
 */
export async function fetchLiveTrack(ident: string, scheduledDepartureIso: string): Promise<LiveTrack | null> {
  "use cache";
  cacheLife({ stale: 60, revalidate: 90, expire: 600 });

  const apiKey = process.env.FLIGHTAWARE_API_KEY;
  if (!apiKey) return null;
  const dep = Date.parse(scheduledDepartureIso);
  const flights = await flightsFor(
    ident,
    apiKey,
    "designator",
    new Date(dep - 24 * 3600_000).toISOString(),
    new Date(dep + 24 * 3600_000).toISOString(),
  );
  if (!flights.length) return null;
  const raw = flights.reduce((best, f) => {
    const d = Math.abs(Date.parse(s(f.scheduled_out) ?? "") - dep);
    const bd = Math.abs(Date.parse(s(best.scheduled_out) ?? "") - dep);
    return d < bd ? f : best;
  });
  const flight = toFlight(raw);
  if (isAirborne(raw)) flight.position = await position(flight.fa_flight_id, apiKey);

  let inbound: LiveFlight | null = null;
  if (flight.inbound_fa_flight_id && !flight.departure.actual) {
    const [rawInbound] = await flightsFor(flight.inbound_fa_flight_id, apiKey, "fa_flight_id");
    if (rawInbound) {
      inbound = toFlight(rawInbound);
      if (isAirborne(rawInbound)) inbound.position = await position(inbound.fa_flight_id, apiKey);
    }
  }
  return { flight, inbound };
}
