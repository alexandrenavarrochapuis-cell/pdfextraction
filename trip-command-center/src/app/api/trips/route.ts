// GET /api/trips: the signed-in user's trips, upcoming first.

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { listTrips } from "@/lib/data";

export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ trips: await listTrips(session.db) });
}
