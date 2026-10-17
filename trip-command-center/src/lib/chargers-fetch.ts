// Cached Overpass lookup of Superchargers along a drive, for a day.

import "server-only";
import { cacheLife } from "next/cache";
import { corridorBox, nearRoute, parseChargers, superchargerQuery, type Box, type Charger, type LatLng } from "./chargers";

const OVERPASS = "https://overpass-api.de/api/interpreter";

async function fetchBox(box: Box): Promise<Charger[]> {
  "use cache";
  cacheLife({ stale: 3_600, revalidate: 86_400, expire: 604_800 });
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "atlas-travel/0.1 (personal itinerary app)" },
    body: `data=${encodeURIComponent(superchargerQuery(box))}`,
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  return parseChargers(await res.json());
}

/** Superchargers within CORRIDOR_KM of the straight lines joining the points. */
export async function superchargersAlong(points: LatLng[]): Promise<Charger[]> {
  const box = corridorBox(points);
  if (!box) return [];
  // Round the box so nearby routes share the cache.
  const rounded = box.map((v, i) => (i < 2 ? Math.floor(v * 10) / 10 : Math.ceil(v * 10) / 10)) as Box;
  return nearRoute(await fetchBox(rounded), points);
}
