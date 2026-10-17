// POST /api/trips/:id/merge { other_trip_id }: fold another trip into this one.
// The merged trip is locked so automatic regrouping keeps it together.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/supabase/server";
import { regroupUser } from "@/lib/trips/regroup";

const Body = z.object({ other_trip_id: z.uuid() });

export async function POST(request: Request, ctx: RouteContext<"/api/trips/[id]/merge">) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { db, user } = session;
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "other_trip_id required" }, { status: 400 });
  const otherId = parsed.data.other_trip_id;
  if (otherId === id) return NextResponse.json({ error: "Cannot merge a trip into itself" }, { status: 400 });

  const { data: trips, error } = await db.from("trips").select("id").in("id", [id, otherId]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if ((trips ?? []).length !== 2) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const moved = await db.from("segments").update({ trip_id: id }).eq("trip_id", otherId);
  if (moved.error) return NextResponse.json({ error: moved.error.message }, { status: 500 });
  await db.from("trips").update({ grouping_locked: true }).eq("id", id);
  await db.from("trips").delete().eq("id", otherId);
  await regroupUser(db, user.id);
  return NextResponse.json({ ok: true, trip_id: id });
}
