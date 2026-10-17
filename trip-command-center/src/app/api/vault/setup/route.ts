// POST /api/vault/setup: store the vault salt and an encrypted check value.
// The passphrase and key never reach the server.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/supabase/server";

const Body = z.object({ salt: z.string().min(16).max(64), check: z.string().min(16).max(256), check_iv: z.string().min(12).max(32) });

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { data: profile } = await session.db.from("profiles").select("vault_salt").eq("id", session.user.id).single();
  if (profile?.vault_salt) return NextResponse.json({ error: "Vault already set up" }, { status: 409 });
  const { error } = await session.db
    .from("profiles")
    .update({ vault_salt: parsed.data.salt, vault_check: parsed.data.check, vault_check_iv: parsed.data.check_iv })
    .eq("id", session.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
