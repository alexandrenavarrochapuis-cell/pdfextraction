// Destination weather for the brief, from Open-Meteo (no API key).
// https://open-meteo.com/en/docs

export interface DayWeather {
  high_f: number;
  low_f: number;
  rain_chance: number | null; // percent
}

interface ForecastResponse {
  daily?: {
    time: string[];
    temperature_2m_max: (number | null)[];
    temperature_2m_min: (number | null)[];
    precipitation_probability_max?: (number | null)[];
  };
}

export async function fetchDayWeather(
  lat: number,
  lng: number,
  tz: string,
  dateKey: string,
): Promise<DayWeather | null> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat.toFixed(4));
  url.searchParams.set("longitude", lng.toFixed(4));
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("timezone", tz);
  url.searchParams.set("start_date", dateKey);
  url.searchParams.set("end_date", dateKey);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = (await res.json()) as ForecastResponse;
    const d = data.daily;
    const high = d?.temperature_2m_max?.[0];
    const low = d?.temperature_2m_min?.[0];
    if (high == null || low == null) return null;
    return {
      high_f: Math.round(high),
      low_f: Math.round(low),
      rain_chance: d?.precipitation_probability_max?.[0] ?? null,
    };
  } catch {
    return null;
  }
}

export function fToC(f: number): number {
  return Math.round(((f - 32) * 5) / 9);
}
