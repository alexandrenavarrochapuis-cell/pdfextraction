// Trip grouping (spec section 4). Pure functions so the rules are unit tested
// without a database; lib/trips/regroup.ts applies the plan to Supabase.
//
// Rules:
// - Segments join a trip when the gap to it is under 48 hours, or when they
//   happen in a city the trip already visits and the gap is under 14 days.
// - A flight or train landing at a home airport (SRQ/TPA) closes the trip; the
//   next segment starts a new one.
// - Trips Alex merged or split by hand (grouping_locked) keep their segments.
//   New segments can still join them under the same rules.
// - Cancelled segments are placed after active ones and never stretch, close
//   or relocate a trip.

import type { Place, Segment, Trip, TripStatus } from "../types";
import { lookupAirport } from "../airports";
import { formatMonthDay } from "../time";

const HOUR = 3600_000;
export const MAX_GAP_MS = 48 * HOUR;
export const MAX_SHARED_CITY_GAP_MS = 14 * 24 * HOUR;

export function normalizeCity(city: string | null | undefined): string | null {
  if (!city) return null;
  const c = city
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return c || null;
}

function placeCity(place: Place | null | undefined): string | null {
  if (!place) return null;
  return place.city ?? lookupAirport(place.code)?.city ?? null;
}

/** The city a segment takes place in, or ends in for transport. */
export function segmentCity(seg: Pick<Segment, "type" | "origin" | "destination">): string | null {
  switch (seg.type) {
    case "car":
      return placeCity(seg.origin) ?? placeCity(seg.destination);
    case "flight":
    case "train":
      return placeCity(seg.destination);
    default:
      return placeCity(seg.destination) ?? placeCity(seg.origin);
  }
}

function homeCities(homeAirports: string[]): Set<string> {
  const set = new Set<string>();
  for (const code of homeAirports) {
    const city = normalizeCity(lookupAirport(code)?.city);
    if (city) set.add(city);
  }
  return set;
}

export function landsHome(seg: Segment, homeAirports: string[]): boolean {
  if (seg.type !== "flight" && seg.type !== "train") return false;
  const code = seg.destination?.code?.toUpperCase();
  return !!code && homeAirports.includes(code);
}

function startMs(seg: Segment): number {
  return Date.parse(seg.start_at as string);
}

function endMs(seg: Segment): number {
  return seg.end_at ? Math.max(Date.parse(seg.end_at), startMs(seg)) : startMs(seg);
}

interface Cluster {
  lockedTripId: string | null;
  segments: Segment[];
  start: number;
  end: number;
  cities: Set<string>;
  closed: boolean; // ended with a landing at a home airport
}

export interface GroupingOptions {
  homeAirports: string[];
}

export interface PlannedTrip {
  /** Existing trip to reuse, or null to create a new one. */
  tripId: string | null;
  segmentIds: string[];
}

export interface GroupingPlan {
  trips: PlannedTrip[];
  /** Existing trips left without segments. */
  deleteTripIds: string[];
  /** Segments without a start time; they live only in the review queue. */
  unassignedSegmentIds: string[];
}

function newCluster(lockedTripId: string | null): Cluster {
  return {
    lockedTripId,
    segments: [],
    start: Infinity,
    end: -Infinity,
    cities: new Set(),
    closed: false,
  };
}

function addToCluster(c: Cluster, seg: Segment, opts: GroupingOptions, home: Set<string>) {
  c.segments.push(seg);
  if (seg.status === "cancelled" && c.segments.some((s) => s.status !== "cancelled")) return;
  c.start = Math.min(c.start, startMs(seg));
  const segEnd = endMs(seg);
  if (segEnd >= c.end) {
    c.end = segEnd;
    c.closed = seg.status !== "cancelled" && landsHome(seg, opts.homeAirports);
  }
  const city = normalizeCity(segmentCity(seg));
  if (city && !home.has(city)) c.cities.add(city);
}

/** Gap in ms between a segment and a cluster, or null if the segment cannot join. */
function gapTo(c: Cluster, seg: Segment, opts: GroupingOptions, home: Set<string>): number | null {
  if (c.segments.length === 0) return null;
  const s = startMs(seg);
  const e = endMs(seg);
  // A trip that ended with a landing at home takes nothing after it.
  if (c.closed && s >= c.end) return null;
  // A landing at home cannot join a trip that starts after it.
  if (landsHome(seg, opts.homeAirports) && e <= c.start && seg.status !== "cancelled") return null;
  const gap = Math.max(0, s - c.end, c.start - e);
  if (gap < MAX_GAP_MS) return gap;
  const city = normalizeCity(segmentCity(seg));
  if (city && !home.has(city) && c.cities.has(city) && gap < MAX_SHARED_CITY_GAP_MS) return gap;
  return null;
}

export function planGrouping(segments: Segment[], trips: Trip[], opts: GroupingOptions): GroupingPlan {
  const home = homeCities(opts.homeAirports);
  const lockedIds = new Set(trips.filter((t) => t.grouping_locked).map((t) => t.id));
  const unassignedSegmentIds = segments.filter((s) => !s.start_at).map((s) => s.id);
  const placeable = segments.filter((s) => s.start_at);

  // Seed one cluster per locked trip with the segments it already holds.
  const clusters: Cluster[] = [];
  const lockedClusters = new Map<string, Cluster>();
  const byStart = (a: Segment, b: Segment) => startMs(a) - startMs(b);
  const lockedSegs = placeable
    .filter((s) => s.trip_id && lockedIds.has(s.trip_id))
    .sort((a, b) => Number(a.status === "cancelled") - Number(b.status === "cancelled") || byStart(a, b));
  for (const seg of lockedSegs) {
    let c = lockedClusters.get(seg.trip_id as string);
    if (!c) {
      c = newCluster(seg.trip_id);
      lockedClusters.set(seg.trip_id as string, c);
      clusters.push(c);
    }
    addToCluster(c, seg, opts, home);
  }

  const free = placeable.filter((s) => !(s.trip_id && lockedIds.has(s.trip_id)));
  const active = free.filter((s) => s.status !== "cancelled").sort(byStart);
  const cancelled = free.filter((s) => s.status === "cancelled").sort(byStart);

  for (const seg of [...active, ...cancelled]) {
    let best: Cluster | null = null;
    let bestGap = Infinity;
    for (const c of clusters) {
      const gap = gapTo(c, seg, opts, home);
      if (gap !== null && gap < bestGap) {
        best = c;
        bestGap = gap;
      }
    }
    if (!best) {
      best = newCluster(null);
      clusters.push(best);
    }
    addToCluster(best, seg, opts, home);
  }

  // Reuse existing trip ids so URLs and sent briefs stay stable across regroups.
  const used = new Set<string>();
  const planned: PlannedTrip[] = [];
  for (const c of clusters) {
    if (c.lockedTripId) used.add(c.lockedTripId);
  }
  const ordered = [...clusters].sort((a, b) => b.segments.length - a.segments.length);
  const assigned = new Map<Cluster, string | null>();
  for (const c of ordered) {
    if (c.lockedTripId) {
      assigned.set(c, c.lockedTripId);
      continue;
    }
    const counts = new Map<string, number>();
    for (const s of c.segments) {
      if (s.trip_id && !used.has(s.trip_id) && !lockedIds.has(s.trip_id)) {
        counts.set(s.trip_id, (counts.get(s.trip_id) ?? 0) + 1);
      }
    }
    let pick: string | null = null;
    let pickCount = 0;
    for (const [id, n] of counts) {
      if (n > pickCount) {
        pick = id;
        pickCount = n;
      }
    }
    if (pick) used.add(pick);
    assigned.set(c, pick);
  }
  for (const c of clusters.sort((a, b) => a.start - b.start)) {
    planned.push({ tripId: assigned.get(c) ?? null, segmentIds: c.segments.map((s) => s.id) });
  }

  const deleteTripIds = trips.map((t) => t.id).filter((id) => !used.has(id));
  return { trips: planned, deleteTripIds, unassignedSegmentIds };
}

export interface TripSummary {
  start_at: string | null;
  end_at: string | null;
  primary_city: string | null;
  title: string;
  status: TripStatus;
}

export function tripStatus(startAt: string | null, endAt: string | null, now: Date): TripStatus {
  if (!startAt) return "upcoming";
  const n = now.getTime();
  if (n < Date.parse(startAt)) return "upcoming";
  if (endAt && n > Date.parse(endAt)) return "past";
  if (!endAt && n > Date.parse(startAt)) return "past";
  return "active";
}

/** Destination city, trip window, auto title and status for a trip's segments. */
export function summarizeTrip(
  segments: Segment[],
  opts: GroupingOptions & { fallbackTz: string; now: Date },
): TripSummary {
  const timed = segments.filter((s) => s.start_at);
  const live = timed.filter((s) => s.status !== "cancelled");
  const basis = live.length ? live : timed;
  if (!basis.length) {
    return { start_at: null, end_at: null, primary_city: null, title: "Unscheduled trip", status: "upcoming" };
  }
  const first = basis.reduce((a, b) => (startMs(b) < startMs(a) ? b : a));
  const last = basis.reduce((a, b) => (endMs(b) > endMs(a) ? b : a));
  const startAt = new Date(startMs(first)).toISOString();
  const endAt = new Date(endMs(last)).toISOString();

  const home = homeCities(opts.homeAirports);
  const stayMs = new Map<string, { label: string; ms: number }>();
  for (const s of basis) {
    if (s.type !== "hotel") continue;
    const label = segmentCity(s);
    const key = normalizeCity(label);
    if (!label || !key || home.has(key)) continue;
    const prev = stayMs.get(key) ?? { label, ms: 0 };
    prev.ms += endMs(s) - startMs(s);
    stayMs.set(key, prev);
  }
  let primary: string | null = null;
  let longest = -1;
  for (const { label, ms } of stayMs.values()) {
    if (ms > longest) {
      primary = label;
      longest = ms;
    }
  }
  if (!primary) {
    const ordered = [...basis].sort((a, b) => startMs(a) - startMs(b));
    for (const s of ordered) {
      const label = segmentCity(s);
      const key = normalizeCity(label);
      if (label && key && !home.has(key)) {
        primary = label;
        break;
      }
    }
  }

  const startTz = first.start_tz ?? opts.fallbackTz;
  const endTz = last.end_tz ?? last.start_tz ?? opts.fallbackTz;
  const from = formatMonthDay(startAt, startTz);
  const to = formatMonthDay(endAt, endTz);
  const place = primary ?? "Trip";
  const title = from === to ? `${place}, ${from}` : `${place}, ${from} to ${to}`;

  return {
    start_at: startAt,
    end_at: endAt,
    primary_city: primary,
    title,
    status: tripStatus(startAt, endAt, opts.now),
  };
}
