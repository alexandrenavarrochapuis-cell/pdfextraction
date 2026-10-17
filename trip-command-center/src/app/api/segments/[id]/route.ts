// PATCH /api/segments/:id: edit, confirm or cancel a segment (review queue
// and timeline). DELETE removes one, e.g. a non-travel email flagged by mistake.

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { cachedGeocoder, openMeteoGeocoder } from "@/lib/geo";
import { applySegmentEdit, SegmentEditSchema } from "@/lib/trips/edit";
import { regroupUser } from "@/lib/trips/regroup";
import type { Segment } from "@/lib/types";

const BLOCKING = ["missing start time", "missing start time zone"];

export async function PATCH(request: Request, ctx: RouteContext<"/api/segments/[id]">) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { db, user } = session;
  const { id } = await ctx.params;
  const parsed = SegmentEditSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const { data, error } = await db.from("segments").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { values, reasons } = await applySegmentEdit(data as Segment, parsed.data, cachedGeocoder(openMeteoGeocoder));
  if (parsed.data.action === "confirm" && reasons.some((r) => BLOCKING.includes(r))) {
    return NextResponse.json(
      { error: "A start time and time zone are needed to place this on the timeline.", reasons },
      { status: 422 },
    );
  }
  const { data: updated, error: updateErr } = await db
    .from("segments")
    .update(values)
    .eq("id", id)
    .select("*")
    .single();
  if (updateErr) {
    const duplicate = updateErr.code === "23505";
    return NextResponse.json(
      { error: duplicate ? "Another segment already has this booking code and start time." : updateErr.message },
      { status: duplicate ? 409 : 500 },
    );
  }
  await regroupUser(db, user.id);
  return NextResponse.json({ segment: updated, reasons });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/segments/[id]">) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const { error } = await session.db.from("segments").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await regroupUser(session.db, session.user.id);
  return NextResponse.json({ ok: true });
}
