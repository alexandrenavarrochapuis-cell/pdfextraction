// Cached lookups for the Today card: the exchange rate from US dollars and
// the day's weather where the traveler is. A failed lookup throws inside the
// cache so it is not kept, and the card shows without it.

import "server-only";
import { cacheLife } from "next/cache";
import { convertCurrency } from "./atlas/money";
import { fetchDayWeather, type DayWeather } from "./brief/weather";

async function rateFromUsd(code: string): Promise<number> {
  "use cache";
  cacheLife("hours");
  const c = await convertCurrency(1, "USD", code);
  if (!c) throw new Error(`No USD rate for ${code}`);
  return c.rate;
}

async function weatherAt(lat: number, lng: number, tz: string, dateKey: string): Promise<DayWeather> {
  "use cache";
  cacheLife("hours");
  const w = await fetchDayWeather(lat, lng, tz, dateKey);
  if (!w) throw new Error("No weather");
  return w;
}

/** Units of `code` per US dollar, or null. */
export async function usdRate(code: string): Promise<number | null> {
  try {
    return await rateFromUsd(code.toUpperCase());
  } catch {
    return null;
  }
}

export async function dayWeather(lat: number, lng: number, tz: string, dateKey: string): Promise<DayWeather | null> {
  try {
    // Round so nearby places share the cache (about 1 km).
    return await weatherAt(Math.round(lat * 100) / 100, Math.round(lng * 100) / 100, tz, dateKey);
  } catch {
    return null;
  }
}
