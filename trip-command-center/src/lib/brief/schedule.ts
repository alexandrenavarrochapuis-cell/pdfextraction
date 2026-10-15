// When to send the day-before brief (spec section 7). The hourly cron sends a
// trip's brief at the first run at or after 7:00 p.m. in Alex's current time
// zone, on the evening before any day with a segment starting (in that
// segment's own zone). The briefs table guarantees one send per trip and date;
// later runs that evening only retry a send that failed.

import type { Segment, Trip } from "../types";
import { addDaysToKey, localDateKey, wallClock } from "../time";

export interface TripWithSegments {
  trip: Trip;
  segments: Segment[];
}

function live(segments: Segment[]): Segment[] {
  return segments.filter((s) => s.status !== "cancelled" && s.start_at);
}

/**
 * Where Alex is right now, as an IANA zone: the place of the latest segment
 * that has started inside the trip under way, or home when no trip is.
 */
export function currentTimezone(trips: TripWithSegments[], now: Date, homeTz: string): string {
  const n = now.getTime();
  const active = trips.find(
    ({ trip }) => trip.start_at && trip.end_at && Date.parse(trip.start_at) <= n && n <= Date.parse(trip.end_at),
  );
  if (!active) return homeTz;
  const started = live(active.segments)
    .filter((s) => Date.parse(s.start_at!) <= n)
    .sort((a, b) => Date.parse(a.start_at!) - Date.parse(b.start_at!));
  const last = started[started.length - 1];
  if (!last) return homeTz;
  if (last.type === "flight" || last.type === "train") {
    const landed = last.end_at && Date.parse(last.end_at) <= n;
    return (landed ? last.end_tz : last.start_tz) ?? last.start_tz ?? homeTz;
  }
  return last.start_tz ?? homeTz;
}

export interface DueBrief {
  trip: Trip;
  segments: Segment[];
  forDate: string; // YYYY-MM-DD
  currentTz: string;
}

export function segmentsStartingOn(segments: Segment[], dateKey: string): Segment[] {
  return live(segments)
    .filter((s) => s.start_tz && localDateKey(s.start_at!, s.start_tz) === dateKey)
    .sort((a, b) => Date.parse(a.start_at!) - Date.parse(b.start_at!));
}

export function dueBriefs(
  trips: TripWithSegments[],
  now: Date,
  opts: { homeTz: string; briefHour: number },
): DueBrief[] {
  const currentTz = currentTimezone(trips, now, opts.homeTz);
  const hour = wallClock(now, currentTz).hour;
  if (hour < opts.briefHour) return [];
  const tomorrow = addDaysToKey(localDateKey(now, currentTz), 1);
  const due: DueBrief[] = [];
  for (const { trip, segments } of trips) {
    if (segmentsStartingOn(segments, tomorrow).length) {
      due.push({ trip, segments, forDate: tomorrow, currentTz });
    }
  }
  return due;
}
