// Reads shared by pages and API routes. Callers pass a session client, so
// RLS limits every query to the signed-in user.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RawEmail, Segment, Trip, TripStatus } from "./types";
import { tripStatus } from "./trips/grouping";

export interface TripCard extends Trip {
  segment_count: number;
  review_count: number;
  cancelled_count: number;
}

const STATUS_ORDER: Record<TripStatus, number> = { upcoming: 0, active: 1, past: 2 };

/** Upcoming first, then active, then past (spec section 6). */
export function sortTrips<T extends Trip>(trips: T[]): T[] {
  return [...trips].sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus) return byStatus;
    const as = a.start_at ? Date.parse(a.start_at) : Infinity;
    const bs = b.start_at ? Date.parse(b.start_at) : Infinity;
    return a.status === "past" ? bs - as : as - bs;
  });
}

export async function listTrips(db: SupabaseClient, now = new Date()): Promise<TripCard[]> {
  const [{ data: trips, error }, { data: segs, error: segErr }] = await Promise.all([
    db.from("trips").select("*"),
    db.from("segments").select("trip_id, status").not("trip_id", "is", null),
  ]);
  if (error) throw error;
  if (segErr) throw segErr;
  const counts = new Map<string, { total: number; review: number; cancelled: number }>();
  for (const s of (segs ?? []) as Pick<Segment, "trip_id" | "status">[]) {
    const c = counts.get(s.trip_id!) ?? { total: 0, review: 0, cancelled: 0 };
    c.total += 1;
    if (s.status === "needs_review") c.review += 1;
    if (s.status === "cancelled") c.cancelled += 1;
    counts.set(s.trip_id!, c);
  }
  const cards = ((trips ?? []) as Trip[]).map((t) => {
    const c = counts.get(t.id) ?? { total: 0, review: 0, cancelled: 0 };
    return {
      ...t,
      // Status is stored, but derive it so a stale cron run never shows the wrong group.
      status: tripStatus(t.start_at, t.end_at, now),
      segment_count: c.total,
      review_count: c.review,
      cancelled_count: c.cancelled,
    };
  });
  return sortTrips(cards);
}

export async function getTrip(
  db: SupabaseClient,
  id: string,
  now = new Date(),
): Promise<{ trip: Trip; segments: Segment[] } | null> {
  const { data: trip, error } = await db.from("trips").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!trip) return null;
  const { data: segments, error: segErr } = await db
    .from("segments")
    .select("*")
    .eq("trip_id", id)
    .order("start_at", { ascending: true, nullsFirst: false });
  if (segErr) throw segErr;
  const t = trip as Trip;
  return { trip: { ...t, status: tripStatus(t.start_at, t.end_at, now) }, segments: (segments ?? []) as Segment[] };
}

export interface ReviewItem {
  segment: Segment;
  email: Pick<RawEmail, "id" | "subject" | "from_addr" | "received_at" | "body_text" | "body_html" | "processing_status"> | null;
}

export async function listReviewItems(db: SupabaseClient): Promise<ReviewItem[]> {
  const { data: segs, error } = await db
    .from("segments")
    .select("*")
    .eq("status", "needs_review")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const segments = (segs ?? []) as Segment[];
  const emailIds = [...new Set(segments.map((s) => s.source_email_id).filter((x): x is string => !!x))];
  const emails = new Map<string, ReviewItem["email"]>();
  if (emailIds.length) {
    const { data, error: emailErr } = await db
      .from("raw_emails")
      .select("id, subject, from_addr, received_at, body_text, body_html, processing_status")
      .in("id", emailIds);
    if (emailErr) throw emailErr;
    for (const e of data ?? []) emails.set(e.id as string, e as ReviewItem["email"]);
  }
  return segments.map((segment) => ({
    segment,
    email: segment.source_email_id ? emails.get(segment.source_email_id) ?? null : null,
  }));
}

export async function countReview(db: SupabaseClient): Promise<number> {
  const { count, error } = await db
    .from("segments")
    .select("id", { count: "exact", head: true })
    .eq("status", "needs_review");
  if (error) throw error;
  return count ?? 0;
}
