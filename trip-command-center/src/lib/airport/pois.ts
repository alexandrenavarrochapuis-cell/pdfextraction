// Points of interest inside airports from OpenStreetMap (Overpass API):
// gates, check-in, baggage claim, restrooms, food, lounges, shops, security,
// services. Coverage is
// good at large hubs and thinner at small airports; levels come from the
// OSM "level" tag when mapped.

export type PoiCategory =
  | "gate"
  | "checkin"
  | "baggage"
  | "restroom"
  | "food"
  | "lounge"
  | "shop"
  | "security"
  | "service"
  | "info";

export interface AirportPoi {
  id: string;
  lat: number;
  lng: number;
  category: PoiCategory;
  name: string | null;
  ref: string | null; // gate number
  level: string | null;
}

const CHECKIN_NAME = /check[- ]?in|ticketing|ticket counter|bag drop/i;
const BAGGAGE_NAME = /baggage (claim|reclaim)|carousel/i;
const LOUNGE_NAME = /lounge|sky ?club|admirals|centurion|polaris|maple leaf|salon|clubhouse|flagship/i;

export function classifyPoi(tags: Record<string, string>): PoiCategory | null {
  if (tags.aeroway === "gate") return "gate";
  if (tags.aeroway === "check_in" || tags.amenity === "check_in" || (tags.name && CHECKIN_NAME.test(tags.name) && !tags.shop)) {
    return "checkin";
  }
  if (tags.aeroway === "baggage_claim" || tags.amenity === "baggage_claim" || (tags.name && BAGGAGE_NAME.test(tags.name))) {
    return "baggage";
  }
  if (tags.amenity === "toilets") return "restroom";
  if (tags.amenity === "lounge" || tags.aeroway === "lounge" || (tags.name && LOUNGE_NAME.test(tags.name) && tags.amenity !== "bar")) {
    return "lounge";
  }
  if (tags.aeroway?.includes("security") || tags.amenity === "security_check") return "security";
  if (["restaurant", "cafe", "fast_food", "bar", "pub", "food_court"].includes(tags.amenity)) return "food";
  if (tags.shop) return "shop";
  if (tags.tourism === "information" || tags.amenity === "information") return "info";
  if (["atm", "pharmacy", "drinking_water", "charging_station", "bureau_de_change", "clinic", "first_aid"].includes(tags.amenity)) {
    return "service";
  }
  return null;
}

const SELECTORS = [
  '["aeroway"="gate"]',
  '["aeroway"~"^(check_in|baggage_claim)$"]',
  '["amenity"~"^(check_in|baggage_claim)$"]',
  '["name"~"[Cc]heck-?[Ii]n|[Tt]icketing|[Bb]ag [Dd]rop|[Bb]aggage [Cc]laim|[Bb]aggage [Rr]eclaim"]',
  '["amenity"="toilets"]',
  '["amenity"~"^(restaurant|cafe|fast_food|bar|pub|food_court)$"]',
  '["shop"]',
  '["amenity"="lounge"]',
  '["aeroway"~"lounge|security"]',
  '["name"~"[Ll]ounge|Sky ?Club|Admirals|Centurion|Polaris"]',
  '["amenity"~"^(atm|pharmacy|drinking_water|charging_station|bureau_de_change|clinic|first_aid|information)$"]',
  '["tourism"="information"]',
];

/** Everything inside the airport's mapped boundary, found by its IATA code. */
export function overpassAreaQuery(iata: string): string {
  const code = iata.replace(/[^A-Z]/gi, "").toUpperCase();
  return [
    "[out:json][timeout:40];",
    `nwr["aeroway"="aerodrome"]["iata"="${code}"]->.ap;`,
    ".ap map_to_area->.a;",
    `(${SELECTORS.map((s) => `nwr(area.a)${s};`).join("")});`,
    "out center tags 3000;",
  ].join("");
}

/** Fallback for airports without a mapped boundary: a radius around the reference point. */
export function overpassAroundQuery(lat: number, lng: number, meters = 3000): string {
  const around = `(around:${meters},${lat.toFixed(5)},${lng.toFixed(5)})`;
  return ["[out:json][timeout:40];", `(${SELECTORS.map((s) => `nwr${around}${s};`).join("")});`, "out center tags 3000;"].join("");
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export function parseOverpass(json: unknown): AirportPoi[] {
  const elements = ((json as { elements?: OverpassElement[] })?.elements ?? []) as OverpassElement[];
  const out: AirportPoi[] = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    const category = classifyPoi(tags);
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!category || lat === undefined || lng === undefined) continue;
    out.push({
      id: `${el.type}/${el.id}`,
      lat,
      lng,
      category,
      name: tags.name ?? tags.brand ?? null,
      ref: category === "gate" ? tags.ref ?? tags.name ?? null : null,
      level: tags.level ?? tags["level:ref"] ?? null,
    });
  }
  return out;
}

/** Normalize gate numbers so "F7", "F 7" and "F07" match. */
export function gateKey(ref: string): string {
  const m = /^\s*([A-Z]*)\s*0*(\d+)\s*([A-Z]?)\s*$/i.exec(ref);
  return m ? `${m[1]}${m[2]}${m[3]}`.toUpperCase() : ref.replace(/\s+/g, "").toUpperCase();
}

export function findGate(pois: AirportPoi[], gate: string): AirportPoi | null {
  const want = gateKey(gate);
  return pois.find((p) => p.category === "gate" && p.ref && gateKey(p.ref) === want) ?? null;
}
