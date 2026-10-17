// GET /api/cron/briefs: hourly. Sends each due day-before brief once (spec
// section 7), refreshes trip statuses and moves stalled emails to review.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCron } from "@/lib/cron";
import { driveMinutesTo, homeAirports, userTimezone } from "@/lib/config";
import { buildBrief } from "@/lib/brief/build";
import { alreadyBriefed, dueBriefs, type DueBrief, type SentBrief, type TripWithSegments } from "@/lib/brief/schedule";
import { fetchDayWeather } from "@/lib/brief/weather";
import { failStalledEmails } from "@/lib/ingest/pipeline";
import { sendPushToUser } from "@/lib/push";
import { refreshTripStatuses } from "@/lib/trips/regroup";
import type { Profile, Segment, Trip } from "@/lib/types";

export const maxDuration = 60;

const STALE_CLAIM_MS = 5 * 60_000;

/** Claim the (trip, date) brief row. Returns its id when this run should send. */
async function claim(db: SupabaseClient, userId: string, due: DueBrief, payload: unknown): Promise<string | null> {
  const { data: inserted, error } = await db
    .from("briefs")
    .upsert(
      { user_id: userId, trip_id: due.trip.id, for_date: due.forDate, payload },
      { onConflict: "trip_id,for_date", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw error;
  if (inserted?.length) return inserted[0].id as string;

  // Row exists: retry only an unsent claim old enough that its run is gone.
  const cutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const { data: reclaimed } = await db
    .from("briefs")
    .update({ created_at: new Date().toISOString(), payload })
    .eq("trip_id", due.trip.id)
    .eq("for_date", due.forDate)
    .is("sent_at", null)
    .lt("created_at", cutoff)
    .select("id");
  return reclaimed?.length ? (reclaimed[0].id as string) : null;
}

async function runForUser(db: SupabaseClient, profile: Profile, now: Date) {
  await refreshTripStatuses(db, profile.id, now);
  const since = new Date(now.getTime() - 2 * 86_400_000).toISOString();
  const { data: trips, error } = await db
    .from("trips")
    .select("*")
    .eq("user_id", profile.id)
    .or(`end_at.gte.${since},end_at.is.null`);
  if (error) throw error;
  const tripIds = (trips ?? []).map((t) => t.id as string);
  if (!tripIds.length) return [];
  const { data: segs, error: segErr } = await db.from("segments").select("*").in("trip_id", tripIds);
  if (segErr) throw segErr;

  const withSegments: TripWithSegments[] = ((trips ?? []) as Trip[]).map((trip) => ({
    trip,
    segments: ((segs ?? []) as Segment[]).filter((s) => s.trip_id === trip.id),
  }));
  const results: { trip_id: string; for_date: string; delivered: number | null }[] = [];
  const dueList = dueBriefs(withSegments, now, { homeTz: userTimezone(), briefHour: profile.brief_hour });
  if (!dueList.length) return results;

  const { data: trusted } = await db
    .from("travel_documents")
    .select("id")
    .eq("user_id", profile.id)
    .eq("kind", "trusted_traveler")
    .limit(1);
  const { data: sentRows, error: sentErr } = await db
    .from("briefs")
    .select("trip_id, for_date, payload")
    .eq("user_id", profile.id)
    .in("for_date", [...new Set(dueList.map((d) => d.forDate))])
    .not("sent_at", "is", null);
  if (sentErr) throw sentErr;
  const sent: SentBrief[] = (sentRows ?? []).map((r) => ({
    trip_id: r.trip_id as string | null,
    for_date: r.for_date as string,
    segment_ids: ((r.payload as { segment_ids?: string[] } | null)?.segment_ids ?? []),
  }));

  for (const due of dueList) {
    const payload = await buildBrief({
      trip: due.trip,
      segments: due.segments,
      forDate: due.forDate,
      currentTz: due.currentTz,
      homeTz: userTimezone(),
      homeAirports: homeAirports(),
      driveMinutes: driveMinutesTo,
      now,
      weather: fetchDayWeather,
      trustedTraveler: !!trusted?.length,
    });
    if (alreadyBriefed(due.trip.id, due.forDate, payload.segment_ids, sent)) continue;
    const briefId = await claim(db, profile.id, due, payload);
    if (!briefId) continue;

    let delivered: number | null = null;
    if (profile.push_enabled) {
      delivered = await sendPushToUser(db, profile.id, {
        ...payload.push,
        url: `/trips/${due.trip.id}/brief/${due.forDate}`,
      });
    }
    // With push off the brief page still counts as delivered.
    if (!profile.push_enabled || delivered) {
      await db.from("briefs").update({ sent_at: now.toISOString() }).eq("id", briefId);
    }
    results.push({ trip_id: due.trip.id, for_date: due.forDate, delivered });
  }
  return results;
}

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const now = new Date();
  let stalled = 0;
  try {
    stalled = await failStalledEmails(db, now);
  } catch (err) {
    console.error("[cron/briefs] stalled email sweep:", err);
  }
  const { data: profiles, error } = await db.from("profiles").select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const sent = [];
  for (const profile of (profiles ?? []) as Profile[]) {
    try {
      sent.push(...(await runForUser(db, profile, now)));
    } catch (err) {
      console.error(`[cron/briefs] ${profile.id}:`, err);
    }
  }
  return NextResponse.json({ ok: true, sent, stalled });
}
