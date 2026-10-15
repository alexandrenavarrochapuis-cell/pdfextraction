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
