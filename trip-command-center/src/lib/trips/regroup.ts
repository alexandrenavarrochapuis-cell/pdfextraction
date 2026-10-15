// Apply the grouping plan to the database and refresh every trip's dates,
// city, title and status. Runs after each ingest and each manual edit.
// Phase 1 is single-user and low-volume, so a full regroup per change is cheap.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Segment, Trip } from "../types";
import { homeAirports, userTimezone } from "../config";
import { planGrouping, summarizeTrip, tripStatus } from "./grouping";

export async function regroupUser(db: SupabaseClient, userId: string, now = new Date()): Promise<void> {
  const [{ data: segRows, error: segErr }, { data: tripRows, error: tripErr }] = await Promise.all([
    db.from("segments").select("*").eq("user_id", userId),
    db.from("trips").select("*").eq("user_id", userId),
  ]);
  if (segErr) throw segErr;
  if (tripErr) throw tripErr;
  const segments = (segRows ?? []) as Segment[];
  const trips = (tripRows ?? []) as Trip[];
  const tripsById = new Map(trips.map((t) => [t.id, t]));
  const opts = { homeAirports: homeAirports() };
  const plan = planGrouping(segments, trips, opts);
  const segById = new Map(segments.map((s) => [s.id, s]));

  for (const planned of plan.trips) {
    let tripId = planned.tripId;
    if (!tripId) {
      const { data, error } = await db
        .from("trips")
        .insert({ user_id: userId, title: "New trip" })
        .select("id")
        .single();
      if (error) throw error;
      tripId = data.id as string;
    }
    const moving = planned.segmentIds.filter((id) => segById.get(id)?.trip_id !== tripId);
    if (moving.length) {
      const { error } = await db.from("segments").update({ trip_id: tripId }).in("id", moving).eq("user_id", userId);
      if (error) throw error;
    }
    const tripSegments = planned.segmentIds.map((id) => segById.get(id)!).filter(Boolean);
    const summary = summarizeTrip(tripSegments, { ...opts, fallbackTz: userTimezone(), now });
    const existing = tripsById.get(tripId);
    const update: Partial<Trip> = {
      start_at: summary.start_at,
      end_at: summary.end_at,
      primary_city: summary.primary_city,
      status: summary.status,
    };
    if (!existing?.title_locked) update.title = summary.title;
    const { error } = await db.from("trips").update(update).eq("id", tripId).eq("user_id", userId);
    if (error) throw error;
  }

  const orphaned = plan.unassignedSegmentIds.filter((id) => segById.get(id)?.trip_id);
  if (orphaned.length) {
    const { error } = await db.from("segments").update({ trip_id: null }).in("id", orphaned).eq("user_id", userId);
    if (error) throw error;
  }
  if (plan.deleteTripIds.length) {
    const { error } = await db.from("trips").delete().in("id", plan.deleteTripIds).eq("user_id", userId);
    if (error) throw error;
  }
}

/** Refresh upcoming/active/past without regrouping (cron). */
export async function refreshTripStatuses(db: SupabaseClient, userId: string, now = new Date()): Promise<void> {
  const { data, error } = await db.from("trips").select("*").eq("user_id", userId);
  if (error) throw error;
  for (const t of (data ?? []) as Trip[]) {
    const status = tripStatus(t.start_at, t.end_at, now);
    if (status !== t.status) await db.from("trips").update({ status }).eq("id", t.id).eq("user_id", userId);
  }
}
