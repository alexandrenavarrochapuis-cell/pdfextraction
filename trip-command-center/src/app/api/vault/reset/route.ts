// POST /api/vault/reset { confirm: "DELETE" }: for a forgotten passphrase.
// Deletes every vault document and scan, then clears the passphrase setup.

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { confirm?: string };
  if (body.confirm !== "DELETE") return NextResponse.json({ error: "Confirmation required" }, { status: 400 });
  const { data: docs } = await session.db.from("travel_documents").select("scan_path");
  const paths = (docs ?? []).map((d) => d.scan_path as string | null).filter((p): p is string => !!p);
  if (paths.length) await createAdminClient().storage.from("vault").remove(paths);
  await session.db.from("travel_documents").delete().eq("user_id", session.user.id);
  await session.db
    .from("profiles")
    .update({ vault_salt: null, vault_check: null, vault_check_iv: null })
    .eq("id", session.user.id);
  return NextResponse.json({ ok: true });
}
