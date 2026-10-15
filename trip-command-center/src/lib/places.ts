// Resolve a place typed or picked in a form: a saved place, an airport code,
// a street address or a city. Returns the place with coordinates and its zone.

import type { SupabaseClient } from "@supabase/supabase-js";
import * as z from "zod";
import type { Place, PlaceKind, SavedPlace } from "./types";
import { lookupAirport } from "./airports";
import type { Geocoder } from "./ingest/draft";

export const PlaceInputSchema = z.object({
  place_id: z.uuid().optional(),
  label: z.string().trim().max(120).optional(),
  address: z.string().trim().max(300).optional(),
  code: z.string().trim().max(5).optional(),
  city: z.string().trim().max(120).optional(),
});
export type PlaceInput = z.infer<typeof PlaceInputSchema>;

export interface ResolvedPlace {
  place: Place;
  tz: string | null;
  kind: PlaceKind | null;
}

export interface PlaceDeps {
  geocodeAddress: (address: string) => Promise<{
    lat: number;
    lng: number;
    city: string | null;
    country: string | null;
    tz: string | null;
  } | null>;
  geocodeCity: Geocoder;
}

export function savedToPlace(p: SavedPlace): Place {
  return { name: p.label, address: p.address, city: p.city, country: p.country, lat: p.lat, lng: p.lng };
}

export async function resolvePlace(
  db: SupabaseClient,
  input: PlaceInput | undefined,
  deps: PlaceDeps,
): Promise<ResolvedPlace | null> {
  if (!input) return null;
  if (input.place_id) {
    const { data } = await db.from("places").select("*").eq("id", input.place_id).maybeSingle();
    if (!data) return null;
    const saved = data as SavedPlace;
    return { place: savedToPlace(saved), tz: saved.tz, kind: saved.kind };
  }
  const airport = lookupAirport(input.code);
  if (airport) {
    return {
      place: { code: airport.code, name: airport.name, city: airport.city, country: airport.country, lat: airport.lat, lng: airport.lng },
      tz: airport.tz,
      kind: null,
    };
  }
  if (input.address) {
    const geo = await deps.geocodeAddress(input.address);
    return {
      place: {
        name: input.label || null,
        address: input.address,
        city: geo?.city ?? input.city ?? null,
        country: geo?.country ?? null,
        lat: geo?.lat ?? null,
        lng: geo?.lng ?? null,
      },
      tz: geo?.tz ?? null,
      kind: null,
    };
  }
  if (input.city) {
    const geo = await deps.geocodeCity(input.city);
    return {
      place: { name: input.label || null, city: input.city, country: geo?.country ?? null, lat: geo?.lat ?? null, lng: geo?.lng ?? null },
      tz: geo?.tz ?? null,
      kind: null,
    };
  }
  return null;
}
