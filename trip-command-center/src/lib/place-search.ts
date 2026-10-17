// Address search for place fields. Google Places (New) when GOOGLE_MAPS_API_KEY
// is set; Photon (OpenStreetMap data, no key) otherwise, or when Google fails.
// Photon suggestions carry their coordinates; a Google suggestion is resolved
// with a details call when picked, in the same session token as the typing,
// which Google bills as one session.
// https://developers.google.com/maps/documentation/places/web-service/place-autocomplete
// https://photon.komoot.io

export interface FoundPlace {
  /** A business or landmark name; null for a plain street address. */
  name: string | null;
  address: string;
  city: string | null;
  region: string | null;
  /** ISO 3166-1 alpha-2. */
  country: string | null;
  lat: number;
  lng: number;
}

export interface PlaceSuggestion {
  id: string;
  primary: string;
  secondary: string | null;
  /** Present when the provider returned coordinates with the suggestion. */
  place: FoundPlace | null;
}

export interface Near {
  lat: number;
  lng: number;
}

const GOOGLE = "https://places.googleapis.com/v1";
const USER_AGENT = "atlas-travel/0.1 (personal itinerary app)";

// Google ----------------------------------------------------------------------

export interface GoogleAutocompleteResponse {
  suggestions?: {
    placePrediction?: {
      placeId: string;
      text?: { text: string };
      structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } };
    };
  }[];
}

export function parseGoogleSuggestions(data: GoogleAutocompleteResponse): PlaceSuggestion[] {
  return (data.suggestions ?? []).flatMap(({ placePrediction: p }) =>
    p
      ? [
          {
            id: `google:${p.placeId}`,
            primary: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
            secondary: p.structuredFormat?.secondaryText?.text ?? null,
            place: null,
          },
        ]
      : [],
  );
}

export interface GooglePlace {
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  addressComponents?: { longText: string; shortText: string; types: string[] }[];
}

export function parseGooglePlace(p: GooglePlace): FoundPlace | null {
  if (!p.location || !p.formattedAddress) return null;
  const part = (type: string, short = false) => {
    const c = p.addressComponents?.find((x) => x.types.includes(type));
    return c ? (short ? c.shortText : c.longText) : null;
  };
  const name = p.displayName?.text ?? null;
  return {
    // A street address comes back with itself as the display name.
    name: name && !p.formattedAddress.startsWith(name) ? name : null,
    address: p.formattedAddress,
    city: part("locality") ?? part("postal_town") ?? part("sublocality") ?? part("administrative_area_level_2"),
    region: part("administrative_area_level_1"),
    country: part("country", true),
    lat: p.location.latitude,
    lng: p.location.longitude,
  };
}

async function googleAutocomplete(q: string, key: string, near: Near | null, session: string | null) {
  const body: Record<string, unknown> = { input: q, languageCode: "en" };
  if (session) body.sessionToken = session;
  if (near) body.locationBias = { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50000 } };
  const res = await fetch(`${GOOGLE}/places:autocomplete`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Google Places autocomplete ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return parseGoogleSuggestions((await res.json()) as GoogleAutocompleteResponse);
}

/** Coordinates and address for a picked Google suggestion. */
export async function placeDetails(id: string, session: string | null): Promise<FoundPlace | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const placeId = id.startsWith("google:") ? id.slice("google:".length) : null;
  if (!key || !placeId || !/^[\w-]{1,300}$/.test(placeId)) return null;
  const url = new URL(`${GOOGLE}/places/${placeId}`);
  url.searchParams.set("languageCode", "en");
  if (session) url.searchParams.set("sessionToken", session);
  try {
    const res = await fetch(url, {
      headers: { "x-goog-api-key": key, "x-goog-fieldmask": "displayName,formattedAddress,location,addressComponents" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error(`Google place details ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    return parseGooglePlace((await res.json()) as GooglePlace);
  } catch {
    return null;
  }
}

// Photon ------------------------------------------------------------------------

export interface PhotonResponse {
  features?: {
    geometry: { coordinates: [number, number] };
    properties: {
      name?: string;
      housenumber?: string;
      street?: string;
      postcode?: string;
      city?: string;
      district?: string;
      county?: string;
      state?: string;
      country?: string;
      countrycode?: string;
      osm_type?: string;
      osm_id?: number;
    };
  }[];
}

export function parsePhoton(data: PhotonResponse): PlaceSuggestion[] {
  return (data.features ?? []).map((f, i) => {
    const p = f.properties;
    const street = [p.housenumber, p.street].filter(Boolean).join(" ") || null;
    const city = p.city ?? p.district ?? p.county ?? null;
    const head = street ?? p.name ?? city ?? "";
    const area = [p.state, p.postcode].filter(Boolean).join(" ") || null;
    const rest = [city && city !== head ? city : null, area, p.country ?? null].filter((x): x is string => !!x);
    const address = [head, ...rest].filter(Boolean).join(", ");
    // A named place with a street (a hotel, a venue) leads with its name.
    const name = p.name && street && p.name !== street ? p.name : null;
    return {
      id: `osm:${p.osm_type ?? ""}${p.osm_id ?? i}`,
      primary: name ?? head,
      secondary: (name ? [street, ...rest] : rest).filter(Boolean).join(", ") || null,
      place: {
        name,
        address,
        city,
        region: p.state ?? null,
        country: p.countrycode ? p.countrycode.toUpperCase() : null,
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
      },
    };
  });
}

export async function photonSearch(q: string, near: Near | null, limit = 6): Promise<PlaceSuggestion[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("lang", "en");
  if (near) {
    url.searchParams.set("lat", near.lat.toFixed(4));
    url.searchParams.set("lon", near.lng.toFixed(4));
  }
  try {
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    return parsePhoton((await res.json()) as PhotonResponse);
  } catch {
    return [];
  }
}

// Entry point -------------------------------------------------------------------

export async function searchPlaces(q: string, near: Near | null, session: string | null): Promise<PlaceSuggestion[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (key) {
    try {
      return await googleAutocomplete(q, key, near, session);
    } catch (err) {
      // A wrong key or a disabled API should not leave the field without suggestions.
      console.error(err);
    }
  }
  return photonSearch(q, near);
}
