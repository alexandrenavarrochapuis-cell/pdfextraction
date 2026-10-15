// Open-Meteo geocoding (no API key). Resolves a city to coordinates and an
// IANA zone for hotels, rentals and venues that are not airports.
// https://open-meteo.com/en/docs/geocoding-api

import type { GeoResult, Geocoder } from "./ingest/draft";

interface OpenMeteoGeoResponse {
  results?: {
    name: string;
    latitude: number;
    longitude: number;
    timezone?: string;
    country_code?: string;
    admin1?: string;
  }[];
}

export const openMeteoGeocoder: Geocoder = async (city, country) => {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", city);
  url.searchParams.set("count", "10");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = (await res.json()) as OpenMeteoGeoResponse;
    const results = (data.results ?? []).filter((r) => r.timezone);
    const wanted = country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null;
    const hit = (wanted && results.find((r) => r.country_code === wanted)) || results[0];
    if (!hit?.timezone) return null;
    const result: GeoResult = {
      name: hit.name,
      country: hit.country_code ?? null,
      region: hit.admin1 ?? null,
      lat: hit.latitude,
      lng: hit.longitude,
      tz: hit.timezone,
    };
    return result;
  } catch {
    return null;
  }
};

/** Memoize per process so one email does not geocode the same city twice. */
export function cachedGeocoder(inner: Geocoder): Geocoder {
  const cache = new Map<string, Promise<GeoResult | null>>();
  return (city, country) => {
    const key = `${city.toLowerCase()}|${(country ?? "").toLowerCase()}`;
    let hit = cache.get(key);
    if (!hit) {
      hit = inner(city, country);
      cache.set(key, hit);
    }
    return hit;
  };
}

export interface AddressResult {
  lat: number;
  lng: number;
  city: string | null;
  region: string | null;
  country: string | null;
  tz: string | null;
  display: string;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  address?: Record<string, string>;
}

/**
 * IANA zone at a coordinate, from Open-Meteo (it resolves timezone=auto from
 * latitude and longitude).
 */
export async function timezoneAt(lat: number, lng: number): Promise<string | null> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat.toFixed(4));
  url.searchParams.set("longitude", lng.toFixed(4));
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("daily", "sunrise");
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { timezone?: string };
    return data.timezone ?? null;
  } catch {
    return null;
  }
}

/**
 * Street address to coordinates with OpenStreetMap Nominatim. Its usage
 * policy allows light use (about one request a second, identified client),
 * which fits a single-user app that geocodes only when a place is saved.
 * https://operations.osmfoundation.org/policies/nominatim/
 */
export async function geocodeAddress(address: string): Promise<AddressResult | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", address);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "trip-command-center/0.1 (personal itinerary app)", "accept-language": "en" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const [hit] = (await res.json()) as NominatimResult[];
    if (!hit) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    const a = hit.address ?? {};
    return {
      lat,
      lng,
      city: a.city ?? a.town ?? a.village ?? a.municipality ?? a.hamlet ?? a.county ?? null,
      region: a.state ?? null,
      country: a.country_code ? a.country_code.toUpperCase() : null,
      tz: await timezoneAt(lat, lng),
      display: hit.display_name,
    };
  } catch {
    return null;
  }
}
