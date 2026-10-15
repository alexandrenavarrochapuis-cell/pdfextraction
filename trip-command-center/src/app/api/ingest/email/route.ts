// POST /api/ingest/email: Resend inbound webhook (spec section 3).
// Verifies the signature, stores the email, answers 200 right away and runs
// extraction after the response so Resend's webhook timeout never bites.

import { after, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createExtractDeps, createResend } from "@/lib/ingest/deps";
import { processRawEmail, receiveEmail } from "@/lib/ingest/pipeline";
import { SignatureError, verifyResendWebhook } from "@/lib/ingest/verify";

export const maxDuration = 60;

interface ReceivedEvent {
  type: string;
  data?: { email_id?: string };
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });

  const rawBody = await request.text();
  let event: ReceivedEvent;
  try {
    event = verifyResendWebhook(rawBody, request.headers, secret) as ReceivedEvent;
  } catch (err) {
    if (err instanceof SignatureError) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    throw err;
  }

  if (event.type !== "email.received" || !event.data?.email_id) {
    return NextResponse.json({ ignored: event.type });
  }

  const db = createAdminClient();
  const resend = createResend();
  const result = await receiveEmail(db, resend, event.data.email_id);

  if (result.status === "rejected") {
    console.warn(`[ingest] rejected ${event.data.email_id}: ${result.reason}`);
    // 200 so Resend does not retry mail that will never be accepted.
    return NextResponse.json({ rejected: true });
  }
  if (result.status === "stored") {
    const rawId = result.rawId;
    after(() => processRawEmail(db, resend, rawId, createExtractDeps()));
  }
  return NextResponse.json({ ok: true, status: result.status });
}
