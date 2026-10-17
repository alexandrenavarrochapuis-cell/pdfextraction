// GET /api/places/search?q=&session=: address suggestions for place fields,
// biased toward Home when it is saved. Signed-in only: with a Google key, each
// call is billed to it.

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { searchPlaces } from "@/lib/place-search";

const SESSION = /^[0-9a-f-]{36}$/i;

export async function GET(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const q = (params.get("q") ?? "").trim().slice(0, 200);
  if (q.length < 3) return NextResponse.json({ suggestions: [] });
  const token = params.get("session");
  const { data: home } = await session.db
    .from("places")
    .select("lat, lng")
    .eq("kind", "home")
    .not("lat", "is", null)
    .limit(1)
    .maybeSingle();
  const near = home?.lat != null && home?.lng != null ? { lat: Number(home.lat), lng: Number(home.lng) } : null;
  const suggestions = await searchPlaces(q, near, token && SESSION.test(token) ? token : null);
  return NextResponse.json({ suggestions }, { headers: { "cache-control": "private, no-store" } });
}
