// Everything the flight map shows, assembled from the stored segment, the
// optional live feed and the clock. Pure, so it is unit tested.

import type { Place, Segment } from "../types";
import { lookupAirport } from "../airports";
import type { LiveFlight, LiveTrack } from "./aeroapi";
import {
  bearing,
  interpolateGreatCircle,
  scheduleEstimate,
  trackingLinks,
  type FlightPhase,
  type LatLng,
} from "./track";

export interface MapAirport extends LatLng {
  code: string | null;
  label: string;
}

export interface MapPlane extends LatLng {
  heading: number;
  source: "live" | "estimate";
  altitude_ft: number | null;
  groundspeed_kt: number | null;
  at: string | null;
}

export interface TrackView {
  segment_id: string;
  title: string;
  flight_number: string | null;
  origin: MapAirport;
  destination: MapAirport;
  depart_at: string;
  depart_tz: string;
  arrive_at: string;
  arrive_tz: string;
  phase: FlightPhase;
  progress: number;
  plane: MapPlane | null;
  live: Omit<LiveFlight, "position" | "fa_flight_id" | "inbound_fa_flight_id" | "origin" | "destination"> | null;
  inbound: {
    ident: string;
    status: string | null;
    origin: MapAirport | null;
    arrival: LiveFlight["arrival"];
    plane: MapPlane | null;
  } | null;
  links: { flightaware: string; flightradar24: string } | null;
  live_configured: boolean;
  refreshed_at: string;
}

function mapAirport(place: Place | null): MapAirport | null {
  const airport = lookupAirport(place?.code);
  const lat = place?.lat ?? airport?.lat;
  const lng = place?.lng ?? airport?.lng;
  if (lat == null || lng == null) return null;
  const code = place?.code ?? airport?.code ?? null;
  const name = place?.city ?? airport?.city ?? place?.name ?? "";
  return { lat, lng, code, label: code ? `${code} ${name}`.trim() : name };
}

function firstTime(t: LiveFlight["departure"]): string | null {
  return t.actual ?? t.estimated ?? t.scheduled;
}

function estimatePlane(from: LatLng, to: LatLng, progress: number): MapPlane {
  const p = Math.min(Math.max(progress, 0), 1);
  const pos = interpolateGreatCircle(from, to, p);
  const ahead = interpolateGreatCircle(from, to, Math.min(p + 0.01, 1));
  return {
    ...pos,
    heading: p >= 1 ? bearing(from, to) : bearing(pos, ahead),
    source: "estimate",
    altitude_ft: null,
    groundspeed_kt: null,
    at: null,
  };
}

function livePlane(f: LiveFlight, toward: LatLng): MapPlane | null {
  if (!f.position) return null;
  return {
    lat: f.position.lat,
    lng: f.position.lng,
    heading: f.position.heading ?? bearing(f.position, toward),
    source: "live",
    altitude_ft: f.position.altitude_ft,
    groundspeed_kt: f.position.groundspeed_kt,
    at: f.position.at,
  };
}

function phaseFromLive(f: LiveFlight, nowMs: number): { phase: FlightPhase; progress: number | null } {
  if (f.cancelled) return { phase: "cancelled", progress: 0 };
  if (f.arrival.actual) return { phase: "landed", progress: 1 };
  const progress = f.progress_percent != null ? f.progress_percent / 100 : null;
  if (f.position || f.departure.actual) return { phase: progress === 1 ? "landed" : "en_route", progress };
  const dep = Date.parse(firstTime(f.departure) ?? "");
  const arr = Date.parse(firstTime(f.arrival) ?? "");
  if (Number.isFinite(dep) && Number.isFinite(arr)) {
    const est = scheduleEstimate(dep, arr, nowMs);
    // Without an actual departure, treat "should have left" as still boarding.
    return { phase: est.phase === "en_route" || est.phase === "landed" ? "boarding" : est.phase, progress: 0 };
  }
  return { phase: "scheduled", progress: 0 };
}

export function buildTrackView(
  seg: Segment,
  live: LiveTrack | null,
  now: Date,
  liveConfigured: boolean,
): TrackView | null {
  if (seg.type !== "flight" || !seg.start_at || !seg.end_at || !seg.start_tz || !seg.end_tz) return null;
  const origin = mapAirport(seg.origin);
  const destination = mapAirport(seg.destination);
  if (!origin || !destination) return null;
  const nowMs = now.getTime();

  const scheduled = scheduleEstimate(Date.parse(seg.start_at), Date.parse(seg.end_at), nowMs);
  let phase = scheduled.phase;
  let progress = scheduled.progress;
  if (seg.status === "cancelled") phase = "cancelled";
  if (live?.flight) {
    const fromLive = phaseFromLive(live.flight, nowMs);
    phase = fromLive.phase;
    if (fromLive.progress !== null) progress = fromLive.progress;
    else if (phase === "en_route") {
      const dep = Date.parse(firstTime(live.flight.departure) ?? seg.start_at);
      const arr = Date.parse(firstTime(live.flight.arrival) ?? seg.end_at);
      progress = scheduleEstimate(dep, arr, nowMs).progress;
    }
  }

  let plane: MapPlane | null = live?.flight ? livePlane(live.flight, destination) : null;
  if (!plane && (phase === "en_route" || phase === "landed")) plane = estimatePlane(origin, destination, progress);

  let inbound: TrackView["inbound"] = null;
  if (live?.inbound && phase !== "en_route" && phase !== "landed" && phase !== "cancelled") {
    const ib = live.inbound;
    const ibOrigin = mapAirport(ib.origin ? { code: ib.origin.code, name: ib.origin.name } : null);
    let ibPlane = livePlane(ib, origin);
    const ibDep = Date.parse(firstTime(ib.departure) ?? "");
    const ibArr = Date.parse(firstTime(ib.arrival) ?? "");
    if (!ibPlane && ibOrigin && ib.departure.actual && !ib.arrival.actual && Number.isFinite(ibDep) && Number.isFinite(ibArr)) {
      ibPlane = estimatePlane(ibOrigin, origin, scheduleEstimate(ibDep, ibArr, nowMs).progress);
    }
    // Landed: parked at the departure airport, waiting for this flight.
    if (!ibPlane && ib.arrival.actual) ibPlane = estimatePlane(ibOrigin ?? origin, origin, 1);
    inbound = { ident: ib.ident, status: ib.status, origin: ibOrigin, arrival: ib.arrival, plane: ibPlane };
  }

  const flightNumber = seg.details?.flight_number ?? null;
  const f = live?.flight;
  const liveSummary: TrackView["live"] = f
    ? {
        ident: f.ident,
        status: f.status,
        cancelled: f.cancelled,
        diverted: f.diverted,
        progress_percent: f.progress_percent,
        departure: f.departure,
        arrival: f.arrival,
        gate_origin: f.gate_origin,
        terminal_origin: f.terminal_origin,
        gate_destination: f.gate_destination,
        terminal_destination: f.terminal_destination,
        baggage_claim: f.baggage_claim,
        aircraft_type: f.aircraft_type,
        registration: f.registration,
      }
    : null;
  return {
    segment_id: seg.id,
    title: [flightNumber, `${origin.code ?? ""} → ${destination.code ?? ""}`].filter(Boolean).join(" · "),
    flight_number: flightNumber,
    origin,
    destination,
    depart_at: seg.start_at,
    depart_tz: seg.start_tz,
    arrive_at: seg.end_at,
    arrive_tz: seg.end_tz,
    phase,
    progress: Math.min(Math.max(progress, 0), 1),
    plane,
    live: liveSummary,
    inbound,
    links: flightNumber ? trackingLinks(flightNumber) : null,
    live_configured: liveConfigured,
    refreshed_at: now.toISOString(),
  };
}
