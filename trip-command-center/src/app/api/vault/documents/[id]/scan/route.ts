// PUT stores an encrypted scan (body is ciphertext; IV and original type in
// headers). GET returns the ciphertext for the browser to decrypt.

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_BYTES = 12 * 1024 * 1024;

export async function PUT(request: Request, ctx: RouteContext<"/api/vault/documents/[id]/scan">) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const iv = request.headers.get("x-scan-iv");
  const type = request.headers.get("x-scan-type") ?? "application/octet-stream";
  if (!iv || iv.length > 32) return NextResponse.json({ error: "Missing IV" }, { status: 400 });
  const { data: doc } = await session.db.from("travel_documents").select("id").eq("id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_BYTES) return NextResponse.json({ error: "Scan is too large" }, { status: 400 });
  const path = `${session.user.id}/${id}.bin`;
  const { error } = await createAdminClient()
    .storage.from("vault")
    .upload(path, bytes, { contentType: "application/octet-stream", upsert: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await session.db.from("travel_documents").update({ scan_path: path, scan_iv: iv, scan_type: type.slice(0, 80) }).eq("id", id);
  return NextResponse.json({ ok: true });
}

export async function GET(_request: Request, ctx: RouteContext<"/api/vault/documents/[id]/scan">) {
  const session = await getSessionUser();
  if (!session) return new Response("Not signed in", { status: 401 });
  const { id } = await ctx.params;
  const { data: doc } = await session.db.from("travel_documents").select("scan_path").eq("id", id).maybeSingle();
  if (!doc?.scan_path) return new Response("Not found", { status: 404 });
  const { data, error } = await createAdminClient().storage.from("vault").download(doc.scan_path);
  if (error || !data) return new Response("Not found", { status: 404 });
  return new Response(data, { headers: { "content-type": "application/octet-stream", "cache-control": "private, no-store" } });
}
