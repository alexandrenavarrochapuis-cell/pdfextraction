// GET /api/assistant/country?code=FR: brief status and content.
// POST { code }: research (or refresh) the brief in the background.

import { after, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runCountryBrief } from "@/lib/assistant/country";

export const maxDuration = 300;

const Code = z.string().regex(/^[A-Z]{2}$/);

export async function GET(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const code = Code.safeParse(new URL(request.url).searchParams.get("code")?.toUpperCase());
  if (!code.success) return NextResponse.json({ error: "code required" }, { status: 400 });
  const { data } = await session.db
    .from("country_briefs")
    .select("status, error, generated_at")
    .eq("country_code", code.data)
    .maybeSingle();
  return NextResponse.json(data ?? { status: "missing" });
}

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const code = Code.safeParse(body.code?.toUpperCase());
  if (!code.success) return NextResponse.json({ error: "code required" }, { status: 400 });
  const { data: existing } = await session.db
    .from("country_briefs")
    .select("status, created_at")
    .eq("country_code", code.data)
    .maybeSingle();
  // A run already under way (started in the last 10 minutes) is not restarted.
  if (existing?.status === "pending" && Date.now() - Date.parse(existing.created_at) < 600_000) {
    return NextResponse.json({ status: "pending" });
  }
  const { error } = await session.db
    .from("country_briefs")
    .upsert(
      { user_id: session.user.id, country_code: code.data, status: "pending", error: null, created_at: new Date().toISOString() },
      { onConflict: "user_id,country_code" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const userId = session.user.id;
  after(() => runCountryBrief(createAdminClient(), userId, code.data));
  return NextResponse.json({ status: "pending" });
}
