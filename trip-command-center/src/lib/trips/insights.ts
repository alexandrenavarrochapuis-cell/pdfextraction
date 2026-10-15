// Things worth pointing out on a trip timeline: connections between flights
// (with tight ones flagged) and nights with no place to stay booked.

import type { Segment } from "../types";
import { lookupAirport } from "../airports";
import { addDaysToKey, localDateKey } from "../time";
import { landsHome, normalizeCity, segmentCity } from "./grouping";

export interface Connection {
  from_segment_id: string;
  to_segment_id: string;
  airport: string; // code or city
  minutes: number;
  arrive_terminal: string | null;
  depart_terminal: string | null;
  tight: boolean;
}

const live = (segments: Segment[]) =>
  segments.filter((s) => s.status !== "cancelled" && s.start_at && s.start_tz).sort((a, b) => Date.parse(a.start_at!) - Date.parse(b.start_at!));

function country(code: string | null | undefined, fallback: string | null | undefined): string | null {
  return fallback ?? lookupAirport(code)?.country ?? null;
}

/** Back-to-back flights or trains through the same airport or station within 24 hours. */
export function findConnections(segments: Segment[]): Connection[] {
  const transport = live(segments).filter((s) => s.type === "flight" || s.type === "train");
  const out: Connection[] = [];
  for (let i = 1; i < transport.length; i++) {
    const a = transport[i - 1];
    const b = transport[i];
    if (!a.end_at) continue;
    const sameCode = a.destination?.code && a.destination.code === b.origin?.code;
    const sameCity =
      !sameCode && normalizeCity(a.destination?.city) && normalizeCity(a.destination?.city) === normalizeCity(b.origin?.city);
    if (!sameCode && !sameCity) continue;
    const minutes = Math.round((Date.parse(b.start_at!) - Date.parse(a.end_at)) / 60_000);
    if (minutes <= 0 || minutes > 24 * 60) continue;
    const countries = [
      country(a.origin?.code, a.origin?.country),
      country(a.destination?.code, a.destination?.country),
      country(b.destination?.code, b.destination?.country),
    ];
    const international = new Set(countries.filter(Boolean)).size > 1;
    out.push({
      from_segment_id: a.id,
      to_segment_id: b.id,
      airport: a.destination?.code ?? a.destination?.city ?? "",
      minutes,
      arrive_terminal: a.details?.arrival_terminal ?? null,
      depart_terminal: b.details?.departure_terminal ?? null,
      // Rough rule of thumb; airlines publish their own minimum connection times.
      tight: minutes < (international ? 90 : 60),
    });
  }
  return out;
}

export interface StayGap {
  city: string;
  check_in: string; // YYYY-MM-DD, first uncovered night
  check_out: string; // YYYY-MM-DD, morning after the last uncovered night
}

function endTz(s: Segment): string {
  return s.end_tz ?? s.start_tz!;
}

/**
 * Nights away from home with no stay booked. A night is covered by a stay
 * (hotel, Booking.com, Airbnb), an overnight stop with family or friends, or
 * an overnight flight, train or drive.
 */
export function findStayGaps(segments: Segment[], homeAirports: string[], homeCities: string[] = []): StayGap[] {
  const segs = live(segments);
  if (!segs.length) return [];
  const first = segs[0];
  const last = segs.reduce((a, b) => (Date.parse(b.end_at ?? b.start_at!) > Date.parse(a.end_at ?? a.start_at!) ? b : a));
  const firstNight = localDateKey(first.start_at!, first.start_tz!);
  const lastMorning = localDateKey(last.end_at ?? last.start_at!, endTz(last));
  const home = new Set([
    ...homeCities.map((c) => normalizeCity(c)),
    ...homeAirports.map((c) => normalizeCity(lookupAirport(c)?.city)),
  ]);

  const covered = new Set<string>();
  for (const s of segs) {
    const startKey = localDateKey(s.start_at!, s.start_tz!);
    const endKey = s.end_at ? localDateKey(s.end_at, endTz(s)) : startKey;
    const overnightStay = s.type === "hotel" || (s.type === "stop" && (s.details?.stop_kind === "family" || s.details?.stop_kind === "friend"));
    const overnightTravel = s.type === "flight" || s.type === "train" || s.type === "drive";
    if (overnightStay || (overnightTravel && endKey > startKey)) {
      for (let d = startKey; d < endKey; d = addDaysToKey(d, 1)) covered.add(d);
    }
  }

  const gaps: StayGap[] = [];
  for (let night = firstNight; night < lastMorning; night = addDaysToKey(night, 1)) {
    if (covered.has(night)) continue;
    // Where Alex is that evening: the place of the last segment started by then.
    const before = segs.filter((s) => localDateKey(s.start_at!, s.start_tz!) <= night);
    const at = before[before.length - 1];
    if (!at || landsHome(at, homeAirports)) continue;
    const city = segmentCity(at);
    const key = normalizeCity(city);
    if (!city || !key || home.has(key)) continue;
    const prev = gaps[gaps.length - 1];
    if (prev && prev.check_out === night && normalizeCity(prev.city) === key) {
      prev.check_out = addDaysToKey(night, 1);
    } else {
      gaps.push({ city, check_in: night, check_out: addDaysToKey(night, 1) });
    }
  }
  return gaps;
}

export function bookingSearchUrl(gap: StayGap): string {
  const p = new URLSearchParams({ ss: gap.city, checkin: gap.check_in, checkout: gap.check_out, group_adults: "1" });
  return `https://www.booking.com/searchresults.html?${p}`;
}

export function airbnbSearchUrl(gap: StayGap): string {
  const p = new URLSearchParams({ checkin: gap.check_in, checkout: gap.check_out });
  return `https://www.airbnb.com/s/${encodeURIComponent(gap.city)}/homes?${p}`;
}

/** Apple Maps at the airport: it shows indoor maps (gates, security, lounges) at many large airports. */
export function airportMapUrl(code: string | null | undefined): string | null {
  const a = lookupAirport(code);
  if (!a) return code ? `https://maps.apple.com/?q=${encodeURIComponent(`${code} airport`)}` : null;
  return `https://maps.apple.com/?q=${encodeURIComponent(`${a.name} Airport`)}&ll=${a.lat},${a.lng}&z=16`;
}
