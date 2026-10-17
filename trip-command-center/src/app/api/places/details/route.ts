// GET /api/places/details?id=&session=: coordinates and address for a picked
// Google suggestion (OpenStreetMap suggestions already carry them).

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { placeDetails } from "@/lib/place-search";

const SESSION = /^[0-9a-f-]{36}$/i;

export async function GET(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const token = params.get("session");
  const place = await placeDetails(params.get("id") ?? "", token && SESSION.test(token) ? token : null);
  if (!place) return NextResponse.json({ place: null }, { status: 404 });
  return NextResponse.json({ place }, { headers: { "cache-control": "private, no-store" } });
}
