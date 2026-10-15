// GET /api/trips/:id: trip with segments. PATCH renames it.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/supabase/server";
import { getTrip } from "@/lib/data";

export async function GET(_request: Request, ctx: RouteContext<"/api/trips/[id]">) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const result = await getTrip(session.db, id);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(result);
}

const Rename = z.object({ title: z.string().trim().min(1).max(120) });

export async function PATCH(request: Request, ctx: RouteContext<"/api/trips/[id]">) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const parsed = Rename.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "title required" }, { status: 400 });
  const { data, error } = await session.db
    .from("trips")
    .update({ title: parsed.data.title, title_locked: true })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ trip: data });
}
