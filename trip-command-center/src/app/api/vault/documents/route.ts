// POST /api/vault/documents: save a passport or ID. The number and notes
// arrive already encrypted; kind, country and expiry are kept in clear for
// expiry warnings.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/supabase/server";
import { DOCUMENT_KINDS } from "@/lib/types";

const Body = z.object({
  traveler_id: z.uuid().nullable().optional(),
  kind: z.enum(DOCUMENT_KINDS),
  label: z.string().trim().max(80).nullable().optional(),
  issuing_country: z.string().trim().max(60).nullable().optional(),
  expires_on: z.iso.date().nullable().optional(),
  ciphertext: z.string().max(20_000),
  iv: z.string().min(12).max(32),
});

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { data, error } = await session.db
    .from("travel_documents")
    .insert({ ...parsed.data, user_id: session.user.id })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
