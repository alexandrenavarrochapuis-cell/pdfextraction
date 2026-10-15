// POST /api/assistant/plan: start an AI trip plan; it runs in the background
// and the plan page polls for the result.

import { after, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PlanRequestSchema, runPlan } from "@/lib/assistant/planner";

export const maxDuration = 300;

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = PlanRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  if (parsed.data.end_date < parsed.data.start_date) {
    return NextResponse.json({ error: "The end date is before the start date" }, { status: 400 });
  }
  const { data, error } = await session.db
    .from("trip_plans")
    .insert({ user_id: session.user.id, request: parsed.data })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const id = data.id as string;
  after(() => runPlan(createAdminClient(), id, parsed.data));
  return NextResponse.json({ id });
}
