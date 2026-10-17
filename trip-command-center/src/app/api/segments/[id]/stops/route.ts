// POST /api/segments/:id/stops { order }: reorder a drive's stops.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/supabase/server";
import type { Segment } from "@/lib/types";

const Body = z.object({ order: z.array(z.number().int().min(0)).max(9) });

export async function POST(request: Request, ctx: RouteContext<"/api/segments/[id]/stops">) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "order required" }, { status: 400 });
  const { data } = await session.db.from("segments").select("*").eq("id", id).maybeSingle();
  const seg = data as Segment | null;
  if (!seg || seg.type !== "drive") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const stops = seg.details?.stops ?? [];
  const order = parsed.data.order;
  const valid = order.length === stops.length && new Set(order).size === stops.length && order.every((i) => i < stops.length);
  if (!valid) return NextResponse.json({ error: "order must list every stop once" }, { status: 400 });
  const { error } = await session.db
    .from("segments")
    .update({ details: { ...seg.details, stops: order.map((i) => stops[i]) } })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
