// POST /api/push/subscribe: store this device's push subscription.
// DELETE removes it (push toggle off).

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/supabase/server";

const Subscription = z.object({
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = Subscription.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  const { error } = await session.db
    .from("push_subscriptions")
    .upsert(
      { user_id: session.user.id, endpoint: parsed.data.endpoint, keys: parsed.data.keys },
      { onConflict: "endpoint" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = z.object({ endpoint: z.url() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  await session.db.from("push_subscriptions").delete().eq("endpoint", parsed.data.endpoint);
  return NextResponse.json({ ok: true });
}
