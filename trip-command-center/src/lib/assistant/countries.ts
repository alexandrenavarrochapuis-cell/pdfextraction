// Country helpers shared by server and client code.

import { lookupAirport } from "../airports";
import type { Place } from "../types";

export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Countries a trip visits, other than the home country. */
export function tripCountries(
  segments: { origin: Place | null; destination: Place | null }[],
  home = "US",
): string[] {
  const set = new Set<string>();
  for (const s of segments) {
    for (const p of [s.origin, s.destination]) {
      const c = (p?.country ?? lookupAirport(p?.code)?.country)?.toUpperCase();
      if (c && /^[A-Z]{2}$/.test(c) && c !== home) set.add(c);
    }
  }
  return [...set];
}
