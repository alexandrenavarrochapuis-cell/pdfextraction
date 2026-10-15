// Decide how extracted segments change the stored ones (spec section 3, steps
// 6 and 8): insert new bookings, overwrite updated ones, mark cancellations,
// and flag anything incomplete as needs_review. Pure, so it is unit tested.

import type { ExtractedSegment, Place, Segment, SegmentDetails, SegmentStatus } from "../types";
import { computeReviewReasons } from "../ingest/draft";
import { cancellationTargets, findMatch, normalizeCode } from "./dedupe";

export type SegmentValues = Omit<Segment, "id" | "user_id" | "trip_id" | "created_at" | "updated_at">;

export type SegmentWrite =
  | { op: "insert"; values: SegmentValues }
  | { op: "update"; id: string; values: Partial<SegmentValues> };

function statusFor(reasons: string[]): SegmentStatus {
  return reasons.length ? "needs_review" : "confirmed";
}

function mergePlace(next: Place | null, prev: Place | null): Place | null {
  if (!next) return prev;
  if (!prev) return next;
  const out: Place = { ...prev };
  for (const [k, v] of Object.entries(next)) {
    if (v !== null && v !== undefined && v !== "") (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function mergeDetails(next: SegmentDetails, prev: SegmentDetails): SegmentDetails {
  const out: SegmentDetails = { ...prev };
  for (const [k, v] of Object.entries(next)) {
    if (v !== null && v !== undefined && v !== "") (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function toValues(seg: ExtractedSegment, sourceEmailId: string, status: SegmentStatus): SegmentValues {
  return {
    type: seg.type,
    status,
    confirmation_code: normalizeCode(seg.confirmation_code),
    provider: seg.provider,
    start_at: seg.start_at,
    start_tz: seg.start_tz,
    end_at: seg.end_at,
    end_tz: seg.end_tz,
    origin: seg.origin,
    destination: seg.destination,
    details: seg.details,
    source_email_id: sourceEmailId,
    confidence: seg.confidence,
    review_reasons: seg.review_reasons,
  };
}

/** An updated confirmation overwrites the stored segment; fields it omits keep their old values. */
function mergeUpdate(prev: Segment, next: ExtractedSegment): ExtractedSegment {
  const merged: ExtractedSegment = {
    type: next.type,
    action: "confirmed",
    confirmation_code: next.confirmation_code ?? prev.confirmation_code,
    provider: next.provider ?? prev.provider,
    start_at: next.start_at ?? prev.start_at,
    start_tz: next.start_at ? next.start_tz : prev.start_tz,
    end_at: next.end_at ?? prev.end_at,
    end_tz: next.end_at ? next.end_tz : prev.end_tz,
    origin: mergePlace(next.origin, prev.origin),
    destination: mergePlace(next.destination, prev.destination),
    details: mergeDetails(next.details, prev.details ?? {}),
    confidence: next.confidence,
    review_reasons: [],
  };
  merged.review_reasons = computeReviewReasons(merged);
  return merged;
}

export function planSegmentWrites(
  extracted: ExtractedSegment[],
  existing: Segment[],
  sourceEmailId: string,
): SegmentWrite[] {
  const writes: SegmentWrite[] = [];
  // Working copy so several segments in one email see each other.
  const working: Segment[] = existing.map((s) => ({ ...s }));
  let pending = 0;

  const track = (values: SegmentValues): void => {
    working.push({ ...values, id: `pending-${pending++}`, user_id: "", trip_id: null });
  };

  for (const seg of extracted) {
    if (seg.action === "cancelled") {
      const targets = cancellationTargets(seg, working);
      for (const t of targets) {
        if (t.id.startsWith("pending-")) continue;
        writes.push({ op: "update", id: t.id, values: { status: "cancelled", source_email_id: sourceEmailId } });
        t.status = "cancelled";
      }
      if (!targets.length) {
        const reasons = seg.start_at ? [] : ["cancellation for a booking that is not on file"];
        const values = toValues({ ...seg, review_reasons: reasons }, sourceEmailId, reasons.length ? "needs_review" : "cancelled");
        writes.push({ op: "insert", values });
        track(values);
      }
      continue;
    }

    const match = findMatch(seg, working);
    if (match && !match.id.startsWith("pending-")) {
      const merged = mergeUpdate(match, seg);
      const values = toValues(merged, sourceEmailId, statusFor(merged.review_reasons));
      writes.push({ op: "update", id: match.id, values });
      Object.assign(match, values);
      continue;
    }
    if (match) continue; // duplicate of a segment inserted from this same email

    const values = toValues(seg, sourceEmailId, statusFor(seg.review_reasons));
    writes.push({ op: "insert", values });
    track(values);
  }
  return writes;
}
