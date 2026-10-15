// GSA per diem rates for US destinations (free API, api.data.gov key).
// https://open.gsa.gov/api/perdiem/
// Rates are set per federal fiscal year (Oct 1 to Sep 30); lodging varies by
// month and excludes taxes; M&IE is per day. Foreign destinations use the
// State Department's foreign per diem tables instead.

const STATE_CODES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE",
  nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA",
  washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

export function stateCode(state: string | null | undefined): string | null {
  if (!state) return null;
  const s = state.trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return STATE_CODES[s.toLowerCase()] ?? null;
}

/** Federal fiscal year of a date: October starts the next year. */
export function fiscalYear(date: Date): number {
  return date.getUTCMonth() >= 9 ? date.getUTCFullYear() + 1 : date.getUTCFullYear();
}

export interface PerDiem {
  city: string;
  state: string;
  fiscal_year: number;
  month: number; // 1-12
  lodging: number; // USD per night, before taxes
  mie: number; // meals and incidentals, USD per day
  standard_rate: boolean;
  source: string;
}

interface RateEntry {
  city?: string;
  county?: string;
  meals?: number;
  standardRate?: string | boolean;
  months?: { month?: { number?: number; value?: number }[] };
}

/** Pick the rate row for the city (falling back to the first row) from an API response. */
export function parsePerDiem(json: unknown, city: string, state: string, fy: number, month: number): PerDiem | null {
  const rates = (json as { rates?: { rate?: RateEntry[] }[] })?.rates ?? [];
  const rows = rates.flatMap((r) => r.rate ?? []);
  if (!rows.length) return null;
  const want = city.toLowerCase();
  const row =
    rows.find((r) => r.city?.toLowerCase() === want) ??
    rows.find((r) => r.city?.toLowerCase().split(/\s*\/\s*|,\s*/).includes(want)) ??
    rows[0];
  const lodging = row.months?.month?.find((m) => m.number === month)?.value;
  if (typeof lodging !== "number" || typeof row.meals !== "number") return null;
  return {
    city: row.city ?? city,
    state,
    fiscal_year: fy,
    month,
    lodging,
    mie: row.meals,
    standard_rate: row.standardRate === true || row.standardRate === "true",
    source: "https://www.gsa.gov/travel/plan-book/per-diem-rates",
  };
}

export async function fetchPerDiem(city: string, state: string, date: Date): Promise<PerDiem | null> {
  const key = process.env.GSA_API_KEY;
  if (!key) return null;
  const st = stateCode(state);
  if (!st) return null;
  const fy = fiscalYear(date);
  const url = `https://api.gsa.gov/travel/perdiem/v2/rates/city/${encodeURIComponent(city)}/state/${st}/year/${fy}`;
  try {
    const res = await fetch(url, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(8000), next: { revalidate: 86_400 } });
    if (!res.ok) return null;
    return parsePerDiem(await res.json(), city, st, fy, date.getUTCMonth() + 1);
  } catch {
    return null;
  }
}

export const FOREIGN_PER_DIEM_URL = "https://aoprals.state.gov/web920/per_diem.asp";
