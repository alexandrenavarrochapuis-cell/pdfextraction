// Currency conversion and a week of weather for Atlas, from free sources with
// no key: ExchangeRate-API's open endpoint (daily rates, every currency) and
// Open-Meteo.
// https://www.exchangerate-api.com/docs/free  https://open-meteo.com/en/docs

export interface Conversion {
  amount: number;
  from: string;
  to: string;
  result: number;
  rate: number;
  rates_updated: string | null;
  attribution: string;
}

export function convertWithRates(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>,
  updated: string | null,
): Conversion | null {
  const rate = rates[to.toUpperCase()];
  if (!rate) return null;
  return {
    amount,
    from: from.toUpperCase(),
    to: to.toUpperCase(),
    result: Math.round(amount * rate * 100) / 100,
    rate,
    rates_updated: updated,
    attribution: "Rates by Exchange Rate API (https://www.exchangerate-api.com), updated daily; card and cash rates differ.",
  };
}

export async function convertCurrency(amount: number, from: string, to: string): Promise<Conversion | null> {
  const base = from.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
  const res = await fetch(`https://open.er-api.com/v6/latest/${base}`, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  const data = (await res.json()) as { result?: string; rates?: Record<string, number>; time_last_update_utc?: string };
  if (data.result !== "success" || !data.rates) return null;
  return convertWithRates(amount, base, to, data.rates, data.time_last_update_utc ?? null);
}

export interface ForecastDay {
  date: string;
  high_f: number;
  low_f: number;
  high_c: number;
  low_c: number;
  rain_chance: number | null;
}

export async function weekForecast(lat: number, lng: number): Promise<{ timezone: string | null; days: ForecastDay[] } | null> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat.toFixed(4));
  url.searchParams.set("longitude", lng.toFixed(4));
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "7");
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      timezone?: string;
      daily?: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max?: (number | null)[] };
    };
    const d = data.daily;
    if (!d) return null;
    const c = (f: number) => Math.round(((f - 32) * 5) / 9);
    return {
      timezone: data.timezone ?? null,
      days: d.time.map((date, i) => ({
        date,
        high_f: Math.round(d.temperature_2m_max[i]),
        low_f: Math.round(d.temperature_2m_min[i]),
        high_c: c(d.temperature_2m_max[i]),
        low_c: c(d.temperature_2m_min[i]),
        rain_chance: d.precipitation_probability_max?.[i] ?? null,
      })),
    };
  } catch {
    return null;
  }
}
