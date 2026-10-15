// GET /api/flights/:id/track: map data for a flight segment (route, plane
// position, inbound aircraft). Live data needs FLIGHTAWARE_API_KEY; without it
// the plane is estimated from the schedule.

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { fetchLiveTrack } from "@/lib/flight/aeroapi";
import { compactIdent, inTrackingWindow } from "@/lib/flight/track";
import { buildTrackView } from "@/lib/flight/view";
import type { Segment } from "@/lib/types";

export async function GET(_request: Request, ctx: RouteContext<"/api/flights/[id]/track">) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const { data, error } = await session.db.from("segments").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const seg = data as Segment | null;
  if (!seg || seg.type !== "flight") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = new Date();
  const liveConfigured = !!process.env.FLIGHTAWARE_API_KEY;
  let live = null;
  const flightNumber = seg.details?.flight_number;
  if (
    liveConfigured &&
    flightNumber &&
    seg.start_at &&
    seg.end_at &&
    seg.status !== "cancelled" &&
    inTrackingWindow(Date.parse(seg.start_at), Date.parse(seg.end_at), now.getTime())
  ) {
    try {
      live = await fetchLiveTrack(compactIdent(flightNumber), seg.start_at);
    } catch (err) {
      console.error("[flights/track] live lookup failed:", err);
    }
  }

  const view = buildTrackView(seg, live, now, liveConfigured);
  if (!view) {
    return NextResponse.json(
      { error: "This flight needs both airports and times before it can be mapped." },
      { status: 422 },
    );
  }
  return NextResponse.json(view, { headers: { "cache-control": "no-store" } });
}
