// Passport and ID expiry warnings. Many countries want a passport valid for
// at least 6 months after you leave (Schengen asks for 3), so 6 months past
// the end of an international trip is the conservative line.

import type { Segment, TravelDocument } from "../types";
import { lookupAirport } from "../airports";

export type ExpiryStatus = "expired" | "soon" | "ok" | "unknown";

const DAY = 86_400_000;

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export function expiryStatus(expiresOn: string | null, now: Date): ExpiryStatus {
  if (!expiresOn) return "unknown";
  const exp = Date.parse(`${expiresOn}T00:00:00Z`);
  if (exp < now.getTime()) return "expired";
  if (exp < addMonths(now, 6).getTime()) return "soon";
  return "ok";
}

export function isInternational(segments: Segment[], homeCountry = "US"): boolean {
  return segments.some((s) =>
    [s.origin, s.destination].some((p) => {
      const c = p?.country ?? lookupAirport(p?.code)?.country;
      return !!c && c !== homeCountry && c !== "PR" && c !== "VI"; // US territories need no passport
    }),
  );
}

export interface PassportWarning {
  document_id: string;
  traveler_id: string | null;
  expires_on: string;
  days_after_trip: number;
}

/** Passports that expire less than 6 months after an international trip ends. */
export function passportWarnings(documents: TravelDocument[], tripEnd: string | null, segments: Segment[]): PassportWarning[] {
  if (!tripEnd || !isInternational(segments)) return [];
  const end = new Date(tripEnd);
  const line = addMonths(end, 6).getTime();
  return documents
    .filter((d) => d.kind === "passport" && d.expires_on && Date.parse(`${d.expires_on}T00:00:00Z`) < line)
    .map((d) => ({
      document_id: d.id,
      traveler_id: d.traveler_id,
      expires_on: d.expires_on!,
      days_after_trip: Math.round((Date.parse(`${d.expires_on}T00:00:00Z`) - end.getTime()) / DAY),
    }));
}
