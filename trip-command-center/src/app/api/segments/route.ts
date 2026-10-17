// POST /api/segments: add a drive, stop, stay or booking by hand.

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { cachedGeocoder, geocodeAddress, openMeteoGeocoder, timezoneAt } from "@/lib/geo";
import { buildManualSegment, CreateSegmentSchema } from "@/lib/trips/create";
import { regroupUser } from "@/lib/trips/regroup";

export const maxDuration = 30;

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = CreateSegmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const { values, reasons } = await buildManualSegment(session.db, parsed.data, {
    geocodeAddress,
    geocodeCity: cachedGeocoder(openMeteoGeocoder),
    timezoneAt,
  });
  if (!values.start_at) {
    return NextResponse.json(
      { error: "Could not work out the start time. Check the place and the date.", reasons },
      { status: 422 },
    );
  }
  const { data, error } = await session.db
    .from("segments")
    .insert({ ...values, user_id: session.user.id })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await regroupUser(session.db, session.user.id);
  const { data: placed } = await session.db.from("segments").select("id, trip_id").eq("id", data.id).single();
  return NextResponse.json({ id: data.id, trip_id: placed?.trip_id ?? null, reasons });
}
