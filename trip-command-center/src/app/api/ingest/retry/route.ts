// POST /api/ingest/retry { email_id }: re-run extraction for a stored email
// whose first run failed. Used from the review queue.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createExtractDeps, createResend } from "@/lib/ingest/deps";
import { retryRawEmail } from "@/lib/ingest/pipeline";

export const maxDuration = 60;

const Body = z.object({ email_id: z.uuid() });

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "email_id required" }, { status: 400 });

  // RLS confirms the email belongs to the caller before the service client touches it.
  const { data: email } = await session.db
    .from("raw_emails")
    .select("id")
    .eq("id", parsed.data.email_id)
    .maybeSingle();
  if (!email) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await retryRawEmail(createAdminClient(), createResend(), session.user.id, email.id, createExtractDeps());
  return NextResponse.json({ ok: true });
}
