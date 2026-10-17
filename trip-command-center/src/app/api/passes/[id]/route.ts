// PATCH /api/passes/:id reassigns flight or traveler. DELETE removes the pass.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PASS_BUCKET } from "@/lib/passes/store";

const Patch = z.object({ segment_id: z.uuid().nullable().optional(), traveler_id: z.uuid().nullable().optional() });

export async function PATCH(request: Request, ctx: RouteContext<"/api/passes/[id]">) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const parsed = Patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { error } = await session.db.from("boarding_passes").update(parsed.data).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/passes/[id]">) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const { data } = await session.db.from("boarding_passes").select("storage_path").eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (data.storage_path) await createAdminClient().storage.from(PASS_BUCKET).remove([data.storage_path]);
  await session.db.from("boarding_passes").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
