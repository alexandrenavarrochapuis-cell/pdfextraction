// Match an extracted segment to one already stored (spec section 3, step 6).
//
// The stored key is (type, confirmation_code, start_at), but a schedule change
// moves start_at, so an exact key match alone would duplicate a changed flight.
// Matching falls back to the same booking and the same leg:
//   flight/train: same confirmation code and same origin and destination
//   hotel/car:    same confirmation code (one stay or rental per code), nearest
//                 start time when a code covers several
// A cancellation with no times cancels every segment on that booking.

import type { ExtractedSegment, Segment } from "../types";

export function normalizeCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.replace(/[\s-]/g, "").toUpperCase();
  return c || null;
}

function legKey(seg: Pick<Segment, "origin" | "destination">): string | null {
  const o = seg.origin?.code ?? seg.origin?.city;
  const d = seg.destination?.code ?? seg.destination?.city;
  if (!o || !d) return null;
  return `${o}>${d}`.toUpperCase();
}

function distance(a: string | null, b: string | null): number {
  if (!a || !b) return Infinity;
  return Math.abs(Date.parse(a) - Date.parse(b));
}

/** Existing segments on the same booking (same type and confirmation code). */
function sameBooking(incoming: ExtractedSegment, existing: Segment[]): Segment[] {
  const code = normalizeCode(incoming.confirmation_code);
  if (!code) return [];
  return existing.filter(
    (s) => s.type === incoming.type && normalizeCode(s.confirmation_code) === code,
  );
}

export function findMatch(incoming: ExtractedSegment, existing: Segment[]): Segment | null {
  const candidates = sameBooking(incoming, existing);
  if (!candidates.length) return null;

  if (incoming.start_at) {
    const exact = candidates.find((s) => s.start_at && Date.parse(s.start_at) === Date.parse(incoming.start_at!));
    if (exact) return exact;
  }

  if (incoming.type === "flight" || incoming.type === "train") {
    const leg = legKey(incoming);
    const sameLeg = leg ? candidates.filter((s) => legKey(s) === leg) : [];
    if (sameLeg.length === 1) return sameLeg[0];
    if (sameLeg.length > 1) {
      return sameLeg.reduce((a, b) =>
        distance(b.start_at, incoming.start_at) < distance(a.start_at, incoming.start_at) ? b : a,
      );
    }
    // Same flight number on the same booking, e.g. a retimed leg whose airport changed.
    const fn = incoming.details.flight_number?.replace(/\s/g, "").toUpperCase();
    if (fn) {
      const sameFlight = candidates.filter(
        (s) => s.details.flight_number?.replace(/\s/g, "").toUpperCase() === fn,
      );
      if (sameFlight.length === 1) return sameFlight[0];
    }
    return null;
  }

  if (candidates.length === 1) return candidates[0];
  if (!incoming.start_at) return null;
  return candidates.reduce((a, b) =>
    distance(b.start_at, incoming.start_at) < distance(a.start_at, incoming.start_at) ? b : a,
  );
}

/**
 * Segments a cancellation applies to. A cancellation naming specific times or
 * legs targets that segment; one with no times cancels the whole booking.
 */
export function cancellationTargets(incoming: ExtractedSegment, existing: Segment[]): Segment[] {
  const match = findMatch(incoming, existing);
  if (match) return [match];
  if (incoming.start_at || legKey(incoming)) return [];
  const code = normalizeCode(incoming.confirmation_code);
  if (!code) return [];
  return existing.filter(
    (s) =>
      normalizeCode(s.confirmation_code) === code &&
      s.status !== "cancelled" &&
      (incoming.type === "other" || s.type === incoming.type),
  );
}
