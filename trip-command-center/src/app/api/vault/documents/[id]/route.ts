// DELETE /api/vault/documents/:id

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/vault/documents/[id]">) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const { data } = await session.db.from("travel_documents").select("scan_path").eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (data.scan_path) await createAdminClient().storage.from("vault").remove([data.scan_path]);
  await session.db.from("travel_documents").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
