// Tesla Superchargers near a drive. Tesla publishes no API for its charger
// map, so the sites come from OpenStreetMap (Overpass), where Superchargers
// carry brand=Tesla Supercharger or a "Supercharger" name. Destination
// chargers are left out. The cached fetch is in chargers-fetch.ts.

export interface Charger {
  id: string;
  name: string;
  lat: number;
  lng: number;
  stalls: number | null;
  kw: number | null;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export type Box = [south: number, west: number, north: number, east: number];

/** How far off the straight line between stops a charger may be. Roads wander. */
export const CORRIDOR_KM = 25;
/** Larger boxes are split into nothing: the query would be slow and the map unreadable. */
const MAX_SPAN_DEG = 20;

export function corridorBox(points: LatLng[], padKm = CORRIDOR_KM): Box | null {
  if (points.length < 2) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const padLat = padKm / 111;
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const padLng = padKm / (111 * Math.max(0.2, Math.cos((midLat * Math.PI) / 180)));
  const box: Box = [Math.min(...lats) - padLat, Math.min(...lngs) - padLng, Math.max(...lats) + padLat, Math.max(...lngs) + padLng];
  if (box[2] - box[0] > MAX_SPAN_DEG || box[3] - box[1] > MAX_SPAN_DEG) return null;
  return box;
}

export function superchargerQuery([s, w, n, e]: Box): string {
  const bbox = [s, w, n, e].map((v) => v.toFixed(4)).join(",");
  return [
    "[out:json][timeout:40];",
    "(",
    `nwr["amenity"="charging_station"]["brand"~"Tesla Supercharger",i](${bbox});`,
    `nwr["amenity"="charging_station"]["name"~"Supercharger",i](${bbox});`,
    ");",
    "out center tags;",
  ].join("");
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function maxKw(tags: Record<string, string>): number | null {
  let best: number | null = null;
  for (const [key, value] of Object.entries(tags)) {
    if (!/^socket:.+:output$/.test(key) && key !== "charging_station:output") continue;
    const m = /(\d+(?:\.\d+)?)\s*kW/i.exec(value);
    if (m && (best === null || Number(m[1]) > best)) best = Number(m[1]);
  }
  return best;
}

export function parseChargers(json: unknown): Charger[] {
  const elements = ((json as { elements?: OverpassElement[] })?.elements ?? []) as OverpassElement[];
  const seen = new Set<string>();
  const out: Charger[] = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    const id = `${el.type}/${el.id}`;
    if (lat === undefined || lng === undefined || seen.has(id)) continue;
    if (/destination/i.test(`${tags.brand ?? ""} ${tags.name ?? ""}`)) continue;
    seen.add(id);
    const stalls = Number.parseInt(tags.capacity ?? "", 10);
    out.push({
      id,
      name: tags.name ?? "Tesla Supercharger",
      lat,
      lng,
      stalls: Number.isFinite(stalls) ? stalls : null,
      kw: maxKw(tags),
    });
  }
  return out;
}

/** Distance in km from a point to the segment a-b, on a local flat projection. */
function kmToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  const kx = 111.32 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const ky = 110.57;
  const [px, py] = [(p.lng - a.lng) * kx, (p.lat - a.lat) * ky];
  const [bx, by] = [(b.lng - a.lng) * kx, (b.lat - a.lat) * ky];
  const len = bx * bx + by * by;
  const t = len ? Math.max(0, Math.min(1, (px * bx + py * by) / len)) : 0;
  return Math.hypot(px - t * bx, py - t * by);
}

export function nearRoute(chargers: Charger[], points: LatLng[], maxKm = CORRIDOR_KM): Charger[] {
  return chargers.filter((c) => points.slice(1).some((b, i) => kmToSegment(c, points[i], b) <= maxKm));
}
