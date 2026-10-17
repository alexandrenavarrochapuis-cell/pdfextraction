// GET /api/cron/purge: daily. Deletes raw emails (and stored attachments)
// older than 90 days (spec section 10). Extracted segments are kept; their
// source_email_id becomes null.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCron } from "@/lib/cron";
import { RAW_EMAIL_RETENTION_DAYS } from "@/lib/config";
import type { StoredAttachment } from "@/lib/types";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const cutoff = new Date(Date.now() - RAW_EMAIL_RETENTION_DAYS * 86_400_000).toISOString();
  const { data, error } = await db.from("raw_emails").select("id, attachments").lt("received_at", cutoff).limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as { id: string; attachments: StoredAttachment[] | null }[];
  const paths = rows.flatMap((r) => (r.attachments ?? []).map((a) => a.storage_path).filter((p): p is string => !!p));
  if (paths.length) {
    const { error: storageErr } = await db.storage.from("email-attachments").remove(paths);
    if (storageErr) console.error("[cron/purge] storage:", storageErr.message);
  }
  if (rows.length) {
    const { error: delErr } = await db.from("raw_emails").delete().in("id", rows.map((r) => r.id));
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, purged: rows.length, attachments: paths.length });
}
