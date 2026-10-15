// Suggest a shorter order for a road trip's stops, keeping start and end
// fixed. Straight-line distance is a proxy for road distance; good enough to
// catch a stop list entered out of order.

import type { Place } from "../types";

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

type Pt = { lat: number; lng: number };

function routeKm(start: Pt, order: number[], stops: Pt[], end: Pt): number {
  let total = 0;
  let prev = start;
  for (const i of order) {
    total += haversineKm(prev, stops[i]);
    prev = stops[i];
  }
  return total + haversineKm(prev, end);
}

function permutations(n: number): number[][] {
  if (n === 0) return [[]];
  const out: number[][] = [];
  for (const rest of permutations(n - 1)) {
    for (let i = 0; i <= rest.length; i++) out.push([...rest.slice(0, i), n - 1, ...rest.slice(i)]);
  }
  return out;
}

export interface StopOrderSuggestion {
  order: number[]; // indexes into the current stops
  currentKm: number;
  suggestedKm: number;
}

/** Best order by exhaustive search (up to 8 stops), or null when there is nothing to gain. */
export function suggestStopOrder(start: Place | null, stops: Place[], end: Place | null): StopOrderSuggestion | null {
  const has = (p: Place | null | undefined): p is Place & Pt => p?.lat != null && p?.lng != null;
  if (!has(start) || !has(end) || stops.length < 2 || stops.length > 8 || !stops.every(has)) return null;
  const pts = stops as (Place & Pt)[];
  const identity = pts.map((_, i) => i);
  const currentKm = routeKm(start, identity, pts, end);
  let best = identity;
  let bestKm = currentKm;
  for (const order of permutations(pts.length)) {
    const km = routeKm(start, order, pts, end);
    if (km < bestKm - 1e-6) {
      best = order;
      bestKm = km;
    }
  }
  // Only worth suggesting when it saves at least 5% and 10 km.
  if (currentKm - bestKm < Math.max(10, currentKm * 0.05)) return null;
  return { order: best, currentKm: Math.round(currentKm), suggestedKm: Math.round(bestKm) };
}
