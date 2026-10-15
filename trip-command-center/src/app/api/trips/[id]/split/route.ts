// POST /api/trips/:id/split { segment_id }: move that segment and everything
// after it into a new trip. Both trips are locked against regrouping.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/supabase/server";
import { regroupUser } from "@/lib/trips/regroup";
import type { Segment } from "@/lib/types";

const Body = z.object({ segment_id: z.uuid() });

export async function POST(request: Request, ctx: RouteContext<"/api/trips/[id]/split">) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { db, user } = session;
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "segment_id required" }, { status: 400 });

  const { data, error } = await db.from("segments").select("*").eq("trip_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const segments = (data ?? []) as Segment[];
  const pivot = segments.find((s) => s.id === parsed.data.segment_id);
  if (!pivot?.start_at) return NextResponse.json({ error: "Segment not in this trip" }, { status: 404 });
  const pivotStart = Date.parse(pivot.start_at);
  const moving = segments.filter((s) => s.start_at && Date.parse(s.start_at) >= pivotStart).map((s) => s.id);
  if (moving.length === segments.length) {
    return NextResponse.json({ error: "Pick a segment after the first one" }, { status: 400 });
  }

  const { data: created, error: createErr } = await db
    .from("trips")
    .insert({ user_id: user.id, title: "New trip", grouping_locked: true })
    .select("id")
    .single();
  if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 });
  await db.from("segments").update({ trip_id: created.id }).in("id", moving);
  await db.from("trips").update({ grouping_locked: true }).eq("id", id);
  await regroupUser(db, user.id);
  return NextResponse.json({ ok: true, trip_id: created.id });
}
