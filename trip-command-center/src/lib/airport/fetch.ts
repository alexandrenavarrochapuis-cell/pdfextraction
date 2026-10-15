// Cached Overpass lookups. Airport layouts change rarely, so a week is fine.

import "server-only";
import { cacheLife } from "next/cache";
import { lookupAirport } from "../airports";
import { overpassAreaQuery, overpassAroundQuery, parseOverpass, type AirportPoi } from "./pois";

const OVERPASS = "https://overpass-api.de/api/interpreter";

async function run(query: string): Promise<AirportPoi[]> {
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "trip-command-center/0.1 (personal itinerary app)" },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  return parseOverpass(await res.json());
}

export async function fetchAirportPois(code: string): Promise<AirportPoi[]> {
  "use cache";
  cacheLife({ stale: 86_400, revalidate: 604_800, expire: 2_592_000 });
  const pois = await run(overpassAreaQuery(code));
  if (pois.length) return pois;
  const airport = lookupAirport(code);
  return airport ? run(overpassAroundQuery(airport.lat, airport.lng)) : [];
}
