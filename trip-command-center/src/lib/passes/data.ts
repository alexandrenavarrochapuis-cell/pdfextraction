// Boarding passes with their flight and traveler, for the Passes screens.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BoardingPass, Segment, Traveler } from "../types";

export interface PassView {
  pass: BoardingPass;
  segment: Segment | null;
  traveler: Traveler | null;
}

export async function listPasses(db: SupabaseClient): Promise<PassView[]> {
  const [{ data: passes }, { data: travelers }] = await Promise.all([
    db.from("boarding_passes").select("*").order("created_at", { ascending: false }),
    db.from("travelers").select("*"),
  ]);
  const rows = (passes ?? []) as BoardingPass[];
  const segIds = [...new Set(rows.map((p) => p.segment_id).filter((x): x is string => !!x))];
  const { data: segs } = segIds.length ? await db.from("segments").select("*").in("id", segIds) : { data: [] };
  const segById = new Map(((segs ?? []) as Segment[]).map((s) => [s.id, s]));
  const travById = new Map(((travelers ?? []) as Traveler[]).map((t) => [t.id, t]));
  return rows.map((pass) => ({
    pass,
    segment: pass.segment_id ? segById.get(pass.segment_id) ?? null : null,
    traveler: pass.traveler_id ? travById.get(pass.traveler_id) ?? null : null,
  }));
}

/** Upcoming first (soonest departure), then passes without a flight, then past ones. */
export function sortPasses(views: PassView[], now: Date): { upcoming: PassView[]; unmatched: PassView[]; past: PassView[] } {
  const cutoff = now.getTime() - 6 * 3600_000;
  const when = (v: PassView) => (v.segment?.start_at ? Date.parse(v.segment.start_at) : NaN);
  const upcoming = views.filter((v) => when(v) >= cutoff).sort((a, b) => when(a) - when(b));
  const past = views.filter((v) => when(v) < cutoff).sort((a, b) => when(b) - when(a));
  const unmatched = views.filter((v) => Number.isNaN(when(v)));
  return { upcoming, unmatched, past };
}
