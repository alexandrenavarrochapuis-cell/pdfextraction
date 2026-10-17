// Emergency help near a position: the local emergency numbers and the closest
// hospitals, clinics, pharmacies and police stations from OpenStreetMap.

/** Numbers for the countries the family travels to most; 112 works from any GSM mobile phone elsewhere. */
const NUMBERS: Record<string, string> = {
  US: "911",
  CA: "911",
  MX: "911",
  PR: "911",
  DO: "911",
  CR: "911",
  BS: "911 or 919",
  GB: "999 or 112",
  IE: "112 or 999",
  FR: "112 (ambulance 15, police 17, fire 18)",
  DE: "112 (police 110)",
  IT: "112",
  ES: "112",
  PT: "112",
  NL: "112",
  BE: "112",
  CH: "112 (ambulance 144, police 117)",
  AT: "112",
  GR: "112",
  AU: "000 (112 from mobiles)",
  NZ: "111",
  JP: "119 ambulance and fire, 110 police",
};

export const STATE_DEPARTMENT_EMERGENCY =
  "US citizens abroad: State Department emergencies +1-888-407-4747 from the US or Canada, +1-202-501-4444 from overseas.";

export function emergencyNumber(country: string | null): string {
  return (country && NUMBERS[country.toUpperCase()]) ?? "112 works from any mobile phone in most countries; check the local number";
}

export type HelpKind = "hospital" | "clinic" | "pharmacy" | "police";

export interface HelpPlace {
  kind: HelpKind;
  name: string;
  km: number;
  phone: string | null;
  address: string | null;
  emergency_room: boolean;
  directions: string;
}

export function helpQuery(lat: number, lng: number): string {
  const at = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  return [
    "[out:json][timeout:20];",
    "(",
    `nwr["amenity"~"^(hospital|clinic|doctors)$"](around:15000,${at});`,
    `nwr["amenity"="pharmacy"](around:5000,${at});`,
    `nwr["amenity"="police"](around:10000,${at});`,
    ");",
    "out center tags 200;",
  ].join("");
}

interface OverpassElement {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function km(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** The closest few of each kind, nearest first. */
export function parseHelp(json: unknown, lat: number, lng: number, perKind = 3): HelpPlace[] {
  const elements = ((json as { elements?: OverpassElement[] })?.elements ?? []) as OverpassElement[];
  const places: HelpPlace[] = [];
  for (const el of elements) {
    const t = el.tags ?? {};
    const pLat = el.lat ?? el.center?.lat;
    const pLng = el.lon ?? el.center?.lon;
    if (pLat === undefined || pLng === undefined) continue;
    const kind: HelpKind | null =
      t.amenity === "hospital" ? "hospital" : t.amenity === "clinic" || t.amenity === "doctors" ? "clinic" : t.amenity === "pharmacy" ? "pharmacy" : t.amenity === "police" ? "police" : null;
    if (!kind) continue;
    const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
    places.push({
      kind,
      name: t.name ?? t.operator ?? kind,
      km: Math.round(km(lat, lng, pLat, pLng) * 10) / 10,
      phone: t.phone ?? t["contact:phone"] ?? null,
      address: [street, t["addr:city"]].filter(Boolean).join(", ") || null,
      emergency_room: t.emergency === "yes",
      directions: `https://www.google.com/maps/dir/?api=1&destination=${pLat},${pLng}`,
    });
  }
  places.sort((a, b) => a.km - b.km);
  const out: HelpPlace[] = [];
  for (const kind of ["hospital", "clinic", "pharmacy", "police"] as const) {
    // Hospitals with an emergency department first.
    const ofKind = places.filter((p) => p.kind === kind);
    if (kind === "hospital") ofKind.sort((a, b) => Number(b.emergency_room) - Number(a.emergency_room) || a.km - b.km);
    out.push(...ofKind.slice(0, perKind));
  }
  return out;
}

export async function nearbyHelp(lat: number, lng: number): Promise<HelpPlace[]> {
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "atlas-travel/0.1 (personal itinerary app)" },
    body: `data=${encodeURIComponent(helpQuery(lat, lng))}`,
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  return parseHelp(await res.json(), lat, lng);
}

/** Country code at a position, from OpenStreetMap Nominatim. */
export async function countryAt(lat: number, lng: number): Promise<string | null> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", lat.toFixed(5));
  url.searchParams.set("lon", lng.toFixed(5));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("zoom", "3");
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "atlas-travel/0.1 (personal itinerary app)", "accept-language": "en" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { address?: { country_code?: string } };
    return data.address?.country_code?.toUpperCase() ?? null;
  } catch {
    return null;
  }
}
