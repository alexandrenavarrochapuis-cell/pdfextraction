// GET /api/calendar/:token.ics: the private calendar feed. The token is the
// only credential, so it is long and random; rotate it in Settings to revoke.

import { createAdminClient } from "@/lib/supabase/admin";
import { buildIcs } from "@/lib/calendar/ics";
import type { Segment } from "@/lib/types";

export async function GET(request: Request, ctx: RouteContext<"/api/calendar/[token]">) {
  const { token: raw } = await ctx.params;
  const token = raw.replace(/\.ics$/, "");
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) return new Response("Not found", { status: 404 });
  const db = createAdminClient();
  const { data: profile } = await db.from("profiles").select("id").eq("calendar_token", token).maybeSingle();
  if (!profile) return new Response("Not found", { status: 404 });
  const since = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const { data } = await db
    .from("segments")
    .select("*")
    .eq("user_id", profile.id)
    .gte("start_at", since)
    .order("start_at");
  const origin = new URL(request.url).origin;
  return new Response(buildIcs((data ?? []) as Segment[], origin), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "private, max-age=900",
      "content-disposition": 'inline; filename="trips.ics"',
    },
  });
}
