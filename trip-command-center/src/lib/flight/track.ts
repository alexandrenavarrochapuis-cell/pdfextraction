// Geometry and schedule-based estimates for the flight map. When no live feed
// is configured (or it has no position yet), the plane is placed along the
// great-circle route in proportion to elapsed scheduled flight time.

export interface LatLng {
  lat: number;
  lng: number;
}

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Point a fraction `f` (0..1) of the way along the great circle from a to b. */
export function interpolateGreatCircle(a: LatLng, b: LatLng, f: number): LatLng {
  const φ1 = toRad(a.lat);
  const λ1 = toRad(a.lng);
  const φ2 = toRad(b.lat);
  const λ2 = toRad(b.lng);
  const δ =
    2 *
    Math.asin(
      Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2),
    );
  if (δ === 0) return { ...a };
  const A = Math.sin((1 - f) * δ) / Math.sin(δ);
  const B = Math.sin(f * δ) / Math.sin(δ);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return { lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), lng: toDeg(Math.atan2(y, x)) };
}

/**
 * Great-circle polyline from a to b. Longitudes are unwrapped so a route over
 * the antimeridian draws as one continuous line on a web map.
 */
export function greatCirclePath(a: LatLng, b: LatLng, segments = 64): LatLng[] {
  const points: LatLng[] = [];
  for (let i = 0; i <= segments; i++) points.push(interpolateGreatCircle(a, b, i / segments));
  for (let i = 1; i < points.length; i++) {
    let lng = points[i].lng;
    while (lng - points[i - 1].lng > 180) lng -= 360;
    while (lng - points[i - 1].lng < -180) lng += 360;
    points[i] = { ...points[i], lng };
  }
  return points;
}

/** Initial compass bearing from a to b, degrees clockwise from north. */
export function bearing(a: LatLng, b: LatLng): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export type FlightPhase = "scheduled" | "boarding" | "en_route" | "landed" | "cancelled";

export interface ScheduleEstimate {
  phase: FlightPhase;
  /** Share of the flight flown, 0..1. */
  progress: number;
}

const BOARDING_WINDOW_MS = 45 * 60_000;

export function scheduleEstimate(departMs: number, arriveMs: number, nowMs: number): ScheduleEstimate {
  if (nowMs >= arriveMs) return { phase: "landed", progress: 1 };
  if (nowMs >= departMs) {
    const span = Math.max(arriveMs - departMs, 1);
    return { phase: "en_route", progress: (nowMs - departMs) / span };
  }
  return { phase: nowMs >= departMs - BOARDING_WINDOW_MS ? "boarding" : "scheduled", progress: 0 };
}

/** Tracking is worth polling from 12 hours before departure to 3 hours after arrival. */
export function inTrackingWindow(departMs: number, arriveMs: number, nowMs: number): boolean {
  return nowMs >= departMs - 12 * 3600_000 && nowMs <= arriveMs + 3 * 3600_000;
}

/** "AF 91" -> "AF91" for flight-tracking sites and APIs. */
export function compactIdent(flightNumber: string): string {
  return flightNumber.replace(/\s+/g, "").toUpperCase();
}

export function trackingLinks(flightNumber: string): { flightaware: string; flightradar24: string } {
  const ident = compactIdent(flightNumber);
  return {
    flightaware: `https://www.flightaware.com/live/flight/${encodeURIComponent(ident)}`,
    flightradar24: `https://www.flightradar24.com/data/flights/${encodeURIComponent(ident.toLowerCase())}`,
  };
}
