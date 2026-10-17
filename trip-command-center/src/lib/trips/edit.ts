// Manual edits from the review queue and timeline (PATCH /api/segments/:id).
// Edits run through the same finalizeDraft step as extraction, so airports
// and cities resolve to zones and coordinates the same way.

import * as z from "zod";
import type { Segment } from "../types";
import { SEGMENT_TYPES } from "../types";
import { finalizeDraft, type DraftSegment, type Geocoder } from "../ingest/draft";
import { toLocalInput } from "../time";
import { normalizeCode } from "./dedupe";
import type { SegmentValues } from "./apply";

const nullableText = z.string().trim().max(500).nullable().optional();

const PlaceEdit = z
  .object({
    name: nullableText,
    code: nullableText,
    city: nullableText,
    country: nullableText,
    address: nullableText,
  })
  .nullable()
  .optional();

export const SegmentEditSchema = z.object({
  /** "confirm" resolves a review item; "cancel" marks it cancelled; "save" just edits. */
  action: z.enum(["save", "confirm", "cancel"]).default("save"),
  type: z.enum(SEGMENT_TYPES).optional(),
  provider: nullableText,
  confirmation_code: nullableText,
  start_local: nullableText,
  start_tz: nullableText,
  end_local: nullableText,
  end_tz: nullableText,
  origin: PlaceEdit,
  destination: PlaceEdit,
  details: z.record(z.string(), z.union([z.string().max(2000), z.null()])).optional(),
});

export type SegmentEdit = z.infer<typeof SegmentEditSchema>;

function pick<T>(edit: T | undefined, current: T): T {
  return edit === undefined ? current : edit;
}

function blankToNull(v: string | null | undefined): string | null {
  return v === undefined || v === null || v.trim() === "" ? null : v.trim();
}

export async function applySegmentEdit(
  segment: Segment,
  edit: SegmentEdit,
  geocode: Geocoder,
): Promise<{ values: Partial<SegmentValues>; reasons: string[] }> {
  if (edit.action === "cancel") {
    return { values: { status: "cancelled" }, reasons: [] };
  }
  const details = { ...segment.details } as Record<string, unknown>;
  for (const [k, v] of Object.entries(edit.details ?? {})) details[k] = blankToNull(v);

  const draft: DraftSegment = {
    type: edit.type ?? segment.type,
    action: "confirmed",
    confirmation_code: blankToNull(pick(edit.confirmation_code, segment.confirmation_code)),
    provider: blankToNull(pick(edit.provider, segment.provider)),
    start_local: blankToNull(pick(edit.start_local, toLocalInput(segment.start_at, segment.start_tz))),
    start_tz: blankToNull(pick(edit.start_tz, segment.start_tz)),
    end_local: blankToNull(pick(edit.end_local, toLocalInput(segment.end_at, segment.end_tz))),
    end_tz: blankToNull(pick(edit.end_tz, segment.end_tz)),
    origin: edit.origin === undefined ? segment.origin : edit.origin && { ...segment.origin, ...edit.origin },
    destination:
      edit.destination === undefined
        ? segment.destination
        : edit.destination && { ...segment.destination, ...edit.destination },
    details,
    // A person checked it.
    confidence: 1,
  };
  // An edited place should resolve again, not keep stale coordinates.
  for (const place of [draft.origin, draft.destination]) {
    if (place) {
      place.lat = null;
      place.lng = null;
    }
  }

  const seg = await finalizeDraft(draft, geocode);
  const values: Partial<SegmentValues> = {
    type: seg.type,
    confirmation_code: normalizeCode(seg.confirmation_code),
    provider: seg.provider,
    start_at: seg.start_at,
    start_tz: seg.start_tz,
    end_at: seg.end_at,
    end_tz: seg.end_tz,
    origin: seg.origin,
    destination: seg.destination,
    details: seg.details,
    confidence: seg.confidence,
    review_reasons: seg.review_reasons,
  };
  if (edit.action === "confirm") values.status = "confirmed";
  else if (segment.status !== "cancelled") values.status = seg.review_reasons.length ? "needs_review" : "confirmed";
  return { values, reasons: seg.review_reasons };
}
