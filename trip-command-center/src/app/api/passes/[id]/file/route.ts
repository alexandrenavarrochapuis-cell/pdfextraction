// GET /api/passes/:id/file: the pass file. A .pkpass is served as
// application/vnd.apple.pkpass, which Safari hands to Apple Wallet.

import { getSessionUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PASS_BUCKET } from "@/lib/passes/store";

export async function GET(_request: Request, ctx: RouteContext<"/api/passes/[id]/file">) {
  const session = await getSessionUser();
  if (!session) return new Response("Not signed in", { status: 401 });
  const { id } = await ctx.params;
  const { data: pass } = await session.db
    .from("boarding_passes")
    .select("storage_path, content_type, kind")
    .eq("id", id)
    .maybeSingle();
  if (!pass?.storage_path) return new Response("Not found", { status: 404 });
  const { data, error } = await createAdminClient().storage.from(PASS_BUCKET).download(pass.storage_path);
  if (error || !data) return new Response("Not found", { status: 404 });
  const name = pass.storage_path.split("/").pop()!.replace(/^[0-9a-f-]{36}-/, "");
  return new Response(data, {
    headers: {
      "content-type": pass.content_type ?? "application/octet-stream",
      "content-disposition": `${pass.kind === "wallet" ? "attachment" : "inline"}; filename="${name}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
    },
  });
}
