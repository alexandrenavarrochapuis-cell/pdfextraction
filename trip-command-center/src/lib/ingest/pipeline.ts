// Inbound email pipeline (spec section 3): fetch the received email from
// Resend, store it, extract segments, write them, regroup trips.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Resend } from "resend";
import type { RawEmail, Segment, StoredAttachment } from "../types";
import { allowedForwarders, ownerEmail } from "../config";
import { planSegmentWrites } from "../trips/apply";
import { regroupUser } from "../trips/regroup";
import type { EmailForExtraction } from "./claude";
import { extractSegments, type ExtractDeps } from "./extract";
import { isAllowedForwarder } from "./verify";

const ATTACHMENT_BUCKET = "email-attachments";
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_PDFS_FOR_EXTRACTION = 5;
const FAILED_EXTRACTION = "extraction failed";

export type ReceiveResult =
  | { status: "stored"; rawId: string }
  | { status: "duplicate"; rawId: string }
  | { status: "rejected"; reason: string };

export async function resolveOwnerId(db: SupabaseClient): Promise<string> {
  const email = ownerEmail();
  const { data, error } = await db.from("profiles").select("id").eq("email", email).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`No account for ${email} yet. Sign in to the app once before forwarding mail.`);
  return data.id as string;
}

/** Fetch the full message from Resend, apply the forwarder allowlist and store it. */
export async function receiveEmail(db: SupabaseClient, resend: Resend, emailId: string): Promise<ReceiveResult> {
  const { data: email, error } = await resend.emails.receiving.get(emailId);
  if (error || !email) throw new Error(`Resend could not return email ${emailId}: ${error?.message ?? "no data"}`);

  if (!isAllowedForwarder(email.from, email.headers, allowedForwarders())) {
    return { status: "rejected", reason: `sender ${email.from} is not an allowed forwarder` };
  }

  const userId = await resolveOwnerId(db);
  const { data: inserted, error: insertErr } = await db
    .from("raw_emails")
    .upsert(
      {
        user_id: userId,
        provider_email_id: email.id,
        message_id: email.message_id,
        received_at: email.created_at,
        from_addr: email.from,
        to_addrs: email.to,
        subject: email.subject,
        headers: email.headers,
        body_text: email.text,
        body_html: email.html,
        attachments: email.attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          content_type: a.content_type,
          size: a.size,
          storage_path: null,
        })),
      },
      { onConflict: "provider_email_id", ignoreDuplicates: true },
    )
    .select("id");
  if (insertErr) throw insertErr;
  if (inserted?.length) return { status: "stored", rawId: inserted[0].id as string };

  const { data: existing, error: existingErr } = await db
    .from("raw_emails")
    .select("id")
    .eq("provider_email_id", email.id)
    .single();
  if (existingErr) throw existingErr;
  return { status: "duplicate", rawId: existing.id as string };
}

function wantsAttachment(contentType: string, filename: string | null | undefined): "pdf" | "text" | null {
  const name = (filename ?? "").toLowerCase();
  if (contentType === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (contentType.startsWith("text/calendar") || name.endsWith(".ics")) return "text";
  return null;
}

/** Copy PDF and calendar attachments to Storage and hand them to extraction. */
async function collectAttachments(
  db: SupabaseClient,
  resend: Resend,
  raw: RawEmail,
): Promise<{ stored: StoredAttachment[]; pdfs: EmailForExtraction["pdfs"]; texts: EmailForExtraction["textAttachments"] }> {
  const stored: StoredAttachment[] = raw.attachments ?? [];
  const pdfs: EmailForExtraction["pdfs"] = [];
  const texts: EmailForExtraction["textAttachments"] = [];
  if (!raw.provider_email_id || !stored.length) return { stored, pdfs, texts };

  const { data: list, error } = await resend.emails.receiving.attachments.list({ emailId: raw.provider_email_id });
  if (error || !list) return { stored, pdfs, texts };

  for (const a of list.data) {
    const kind = wantsAttachment(a.content_type, a.filename);
    if (!kind || a.size > MAX_ATTACHMENT_BYTES) continue;
    const res = await fetch(a.download_url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) continue;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const safeName = (a.filename ?? a.id).replace(/[^\w.-]+/g, "_");
    const path = `${raw.user_id}/${raw.id}/${safeName}`;
    const { error: upErr } = await db.storage
      .from(ATTACHMENT_BUCKET)
      .upload(path, bytes, { contentType: a.content_type, upsert: true });
    const entry = stored.find((s) => s.id === a.id);
    if (entry && !upErr) entry.storage_path = path;
    if (kind === "pdf" && pdfs.length < MAX_PDFS_FOR_EXTRACTION) {
      pdfs.push({ filename: a.filename ?? null, base64: Buffer.from(bytes).toString("base64") });
    } else if (kind === "text") {
      texts.push({ filename: a.filename ?? null, text: new TextDecoder().decode(bytes) });
    }
  }
  return { stored, pdfs, texts };
}

async function applyWrites(db: SupabaseClient, raw: RawEmail, writes: ReturnType<typeof planSegmentWrites>) {
  for (const w of writes) {
    if (w.op === "update") {
      const { error } = await db.from("segments").update(w.values).eq("id", w.id).eq("user_id", raw.user_id);
      if (error) throw error;
      continue;
    }
    const { error } = await db.from("segments").insert({ ...w.values, user_id: raw.user_id });
    // A webhook retry racing this run can insert the same (type, code, start) first.
    if (error && error.code !== "23505") throw error;
  }
}

/** Extract and store segments for a stored email. Never throws: failures land in the review queue. */
export async function processRawEmail(
  db: SupabaseClient,
  resend: Resend,
  rawId: string,
  deps: ExtractDeps,
): Promise<void> {
  const { data, error } = await db.from("raw_emails").select("*").eq("id", rawId).single();
  if (error) throw error;
  const raw = data as RawEmail;

  try {
    const { stored, pdfs, texts } = await collectAttachments(db, resend, raw);
    await db.from("raw_emails").update({ attachments: stored }).eq("id", raw.id);

    const result = await extractSegments(
      {
        subject: raw.subject,
        from: raw.from_addr,
        sentAt: raw.received_at,
        text: raw.body_text,
        html: raw.body_html,
        pdfs,
        textAttachments: texts,
      },
      deps,
    );

    if (!result.isTravel || result.segments.length === 0) {
      await db
        .from("raw_emails")
        .update({ processing_status: "ignored", extraction_method: result.method, processing_error: null })
        .eq("id", raw.id);
      return;
    }

    const { data: existing, error: segErr } = await db.from("segments").select("*").eq("user_id", raw.user_id);
    if (segErr) throw segErr;
    await applyWrites(db, raw, planSegmentWrites(result.segments, (existing ?? []) as Segment[], raw.id));
    await regroupUser(db, raw.user_id);
    await db
      .from("raw_emails")
      .update({ processing_status: "processed", extraction_method: result.method, processing_error: null })
      .eq("id", raw.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ingest] email ${raw.id} failed:`, message);
    await db.from("raw_emails").update({ processing_status: "failed", processing_error: message }).eq("id", raw.id);
    // Surface the email in the review queue so it can be entered by hand or retried.
    const { data: placeholder } = await db
      .from("segments")
      .select("id")
      .eq("source_email_id", raw.id)
      .contains("review_reasons", [FAILED_EXTRACTION])
      .maybeSingle();
    if (!placeholder) {
      await db.from("segments").insert({
        user_id: raw.user_id,
        type: "other",
        status: "needs_review",
        provider: raw.from_addr,
        details: { note: raw.subject ?? "Forwarded email" },
        source_email_id: raw.id,
        confidence: 0,
        review_reasons: [FAILED_EXTRACTION],
      });
    }
  }
}

/** Re-run extraction for an email, dropping the failure placeholder first. */
export async function retryRawEmail(
  db: SupabaseClient,
  resend: Resend,
  userId: string,
  rawId: string,
  deps: ExtractDeps,
): Promise<void> {
  await db
    .from("segments")
    .delete()
    .eq("user_id", userId)
    .eq("source_email_id", rawId)
    .contains("review_reasons", [FAILED_EXTRACTION]);
  await processRawEmail(db, resend, rawId, deps);
}
