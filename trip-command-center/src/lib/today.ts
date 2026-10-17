// On-trip mode: the trip under way (or leaving within a day), what is
// happening now, what comes next, and where the traveler is. Pure, so it is
// unit tested; the home page adds the weather, the rate and the links.

import { lookupAirport } from "./airports";
import type { Place, Segment, Trip } from "./types";

/** An upcoming trip shows on the Today card from this many hours before it starts. */
export const TODAY_LEAD_HOURS = 24;
const HOUR = 3_600_000;

export type MomentKind = "depart" | "check_in" | "check_out" | "pickup" | "return" | "start";

export interface Moment {
  segment: Segment;
  kind: MomentKind;
  at: string;
  tz: string;
}

export interface Here {
  place: Place;
  tz: string;
  country: string | null;
  lat: number | null;
  lng: number | null;
}

export interface TodayView {
  /** A flight, train or drive under way. */
  current: Moment | null;
  next: Moment | null;
  /** What follows `next` within the next day, at most three. */
  later: Moment[];
  here: Here | null;
}

export function pickTodayTrip<T extends Pick<Trip, "status" | "start_at">>(trips: T[], now: Date): T | null {
  const start = (t: T) => (t.start_at ? Date.parse(t.start_at) : Infinity);
  const active = trips.filter((t) => t.status === "active").sort((a, b) => start(a) - start(b));
  if (active.length) return active[0];
  const soon = trips
    .filter((t) => t.status === "upcoming" && start(t) - now.getTime() <= TODAY_LEAD_HOURS * HOUR)
    .sort((a, b) => start(a) - start(b));
  return soon[0] ?? null;
}

const TRANSPORT = new Set(["flight", "train", "drive"]);

/** Every timed moment of a trip in order: departures, check-ins and check-outs, pickups and returns. */
export function tripMoments(segments: Segment[]): Moment[] {
  const moments: Moment[] = [];
  for (const s of segments) {
    if (s.status === "cancelled" || !s.start_at || !s.start_tz) continue;
    if (s.type === "hotel" || s.type === "car") {
      moments.push({ segment: s, kind: s.type === "hotel" ? "check_in" : "pickup", at: s.start_at, tz: s.start_tz });
      if (s.end_at) {
        moments.push({ segment: s, kind: s.type === "hotel" ? "check_out" : "return", at: s.end_at, tz: s.end_tz ?? s.start_tz });
      }
    } else {
      moments.push({ segment: s, kind: TRANSPORT.has(s.type) ? "depart" : "start", at: s.start_at, tz: s.start_tz });
    }
  }
  return moments.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

function located(place: Place | null | undefined, tz: string | null): Here | null {
  if (!place || !tz) return null;
  const airport = lookupAirport(place.code);
  return {
    place,
    tz,
    country: place.country ?? airport?.country ?? null,
    lat: place.lat ?? airport?.lat ?? null,
    lng: place.lng ?? airport?.lng ?? null,
  };
}

/** Where the traveler is: the end of the last thing that started, or the trip's first departure point. */
export function whereNow(segments: Segment[], now: Date): Here | null {
  const started = segments
    .filter((s) => s.status !== "cancelled" && s.start_at && Date.parse(s.start_at) <= now.getTime())
    .sort((a, b) => Date.parse(a.start_at!) - Date.parse(b.start_at!));
  const last = started[started.length - 1];
  if (!last) {
    const first = segments
      .filter((s) => s.status !== "cancelled" && s.start_at)
      .sort((a, b) => Date.parse(a.start_at!) - Date.parse(b.start_at!))[0];
    return first ? located(first.type === "hotel" ? (first.destination ?? first.origin) : (first.origin ?? first.destination), first.start_tz) : null;
  }
  // Under way or arrived: either way, the destination is the place that matters.
  if (TRANSPORT.has(last.type)) return located(last.destination ?? last.origin, last.end_tz ?? last.start_tz);
  if (last.type === "car") return located(last.origin ?? last.destination, last.start_tz);
  return located(last.destination ?? last.origin, last.start_tz);
}

export function todayView(segments: Segment[], now: Date): TodayView {
  const t = now.getTime();
  const current =
    tripMoments(segments).find(
      (m) =>
        m.kind === "depart" &&
        Date.parse(m.at) <= t &&
        m.segment.end_at != null &&
        Date.parse(m.segment.end_at) > t,
    ) ?? null;
  const ahead = tripMoments(segments).filter((m) => Date.parse(m.at) > t);
  const next = ahead[0] ?? null;
  const later = next
    ? ahead.slice(1).filter((m) => Date.parse(m.at) - t <= 24 * HOUR).slice(0, 3)
    : [];
  return { current, next, later, here: whereNow(segments, now) };
}

export const MOMENT_LABEL: Record<MomentKind, string> = {
  depart: "Departs",
  start: "Starts",
  check_in: "Check-in",
  check_out: "Check-out",
  pickup: "Car pickup",
  return: "Car return",
};

/** The first number to dial from an emergency line such as "112 (police 110)". */
export function dialable(numbers: string): string | null {
  return numbers.match(/\d{3,}/)?.[0] ?? null;
}
