// GET /api/chargers?segment=<drive id>: Tesla Superchargers along a drive.

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { superchargersAlong } from "@/lib/chargers-fetch";
import type { Place, Segment } from "@/lib/types";

export const maxDuration = 60;

export async function GET(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("segment") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Missing segment" }, { status: 400 });
  const { data } = await session.db.from("segments").select("*").eq("id", id).maybeSingle();
  const seg = data as Segment | null;
  if (!seg || seg.type !== "drive") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const points = [seg.origin, ...(seg.details?.stops ?? []), seg.destination]
    .filter((p): p is Place & { lat: number; lng: number } => p?.lat != null && p?.lng != null)
    .map((p) => ({ lat: p.lat, lng: p.lng }));
  try {
    const chargers = await superchargersAlong(points);
    return NextResponse.json({ chargers }, { headers: { "cache-control": "private, max-age=3600" } });
  } catch {
    return NextResponse.json({ error: "The charger map did not answer" }, { status: 502 });
  }
}
