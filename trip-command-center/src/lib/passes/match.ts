// Attach a boarding pass to the right flight and the right family member.

import type { Segment, Traveler } from "../types";
import { localDateKey } from "../time";
import { nameMatches, type Bcbp, julianToDate } from "./bcbp";

export interface PassFacts {
  carrier?: string | null;
  flightNumber?: string | null; // digits, or "DL 84"
  date?: string | null; // YYYY-MM-DD local departure date
  from?: string | null;
  to?: string | null;
  passengerName?: string | null;
  seat?: string | null;
}

function splitFlight(value: string | null | undefined): { carrier: string | null; number: string | null } {
  const m = /^\s*([A-Z0-9]{2}[A-Z]?)?\s*0*(\d{1,4})[A-Z]?\s*$/i.exec(value ?? "");
  return m ? { carrier: m[1]?.toUpperCase() ?? null, number: m[2] } : { carrier: null, number: null };
}

export function factsFromBcbp(bcbp: Bcbp, reference: Date, leg = 0): PassFacts {
  const l = bcbp.legs[leg];
  return {
    carrier: l.carrier,
    flightNumber: l.flightNumber,
    date: julianToDate(l.julianDay, reference),
    from: l.from,
    to: l.to,
    passengerName: bcbp.passengerName,
    seat: l.seat || null,
  };
}

export function matchSegment(facts: PassFacts, segments: Segment[]): Segment | null {
  const want = splitFlight(facts.flightNumber);
  const carrier = (facts.carrier ?? want.carrier)?.toUpperCase() ?? null;
  let best: Segment | null = null;
  let bestScore = 0;
  for (const s of segments) {
    if (s.type !== "flight" || s.status === "cancelled" || !s.start_at || !s.start_tz) continue;
    const have = splitFlight(s.details?.flight_number);
    const numberOk = !!want.number && have.number === want.number && (!carrier || !have.carrier || have.carrier === carrier);
    const dateOk = !!facts.date && localDateKey(s.start_at, s.start_tz) === facts.date;
    const fromOk = !!facts.from && s.origin?.code?.toUpperCase() === facts.from.toUpperCase();
    const toOk = !!facts.to && s.destination?.code?.toUpperCase() === facts.to.toUpperCase();
    const score = (numberOk ? 4 : 0) + (dateOk ? 2 : 0) + (fromOk ? 1 : 0) + (toOk ? 1 : 0);
    const plausible = (numberOk && (dateOk || fromOk)) || (dateOk && fromOk && toOk);
    if (plausible && score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

export function matchTraveler(printedName: string | null | undefined, travelers: Traveler[]): Traveler | null {
  if (!printedName) return null;
  const upper = printedName.toUpperCase().trim();
  return (
    travelers.find((t) => t.name_variants?.some((v) => v.toUpperCase().trim() === upper)) ??
    travelers.find((t) => nameMatches(printedName.includes("/") ? printedName : toSlashed(printedName), t.name)) ??
    null
  );
}

/** "Alexandre Navarro" -> "NAVARRO/ALEXANDRE" so free-text names use the same matcher. */
function toSlashed(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[parts.length - 1]}/${parts.slice(0, -1).join(" ")}`;
}
