// Pages and files to keep on the phone for use without a connection: the
// trips under way and coming up, and their boarding passes (the barcode
// screen and the original file). The service worker saves them (public/sw.js).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Trip } from "./types";

const MAX_TRIPS = 8;

export interface OfflinePass {
  id: string;
  storage_path: string | null;
  barcode_message: string | null;
}

export function offlineUrlList(trips: Pick<Trip, "id" | "status">[], passes: OfflinePass[]): string[] {
  const urls = ["/", "/passes"];
  for (const t of trips.filter((t) => t.status !== "past").slice(0, MAX_TRIPS)) urls.push(`/trips/${t.id}`);
  for (const p of passes) {
    if (p.barcode_message) urls.push(`/passes/${p.id}`);
    if (p.storage_path) urls.push(`/api/passes/${p.id}/file`);
  }
  return urls;
}

export async function offlineUrls(db: SupabaseClient, trips: Pick<Trip, "id" | "status">[]): Promise<string[]> {
  const ids = trips.filter((t) => t.status !== "past").slice(0, MAX_TRIPS).map((t) => t.id);
  if (!ids.length) return offlineUrlList(trips, []);
  const { data: flights } = await db.from("segments").select("id").in("trip_id", ids).eq("type", "flight");
  const flightIds = ((flights ?? []) as { id: string }[]).map((f) => f.id);
  const { data: passes } = flightIds.length
    ? await db.from("boarding_passes").select("id, storage_path, barcode_message").in("segment_id", flightIds)
    : { data: [] };
  return offlineUrlList(trips, (passes ?? []) as OfflinePass[]);
}
