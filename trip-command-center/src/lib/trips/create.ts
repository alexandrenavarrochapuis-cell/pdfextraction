// Manual entries: road trips with stops, personal and meeting stops, stays
// booked outside email, anything a forwarded confirmation did not cover.

import type { SupabaseClient } from "@supabase/supabase-js";
import * as z from "zod";
import { SEGMENT_TYPES, STOP_KINDS, type Place } from "../types";
import { finalizeDraft, type DraftSegment, type Geocoder } from "../ingest/draft";
import { PlaceInputSchema, resolvePlace, type PlaceDeps } from "../places";
import { normalizeCode } from "./dedupe";
import type { SegmentValues } from "./apply";
import { userTimezone } from "../config";

/** Google Maps directions links accept up to 9 waypoints. */
export const MAX_STOPS = 9;

export const CreateSegmentSchema = z.object({
  type: z.enum(SEGMENT_TYPES),
  provider: z.string().trim().max(120).optional(),
  confirmation_code: z.string().trim().max(40).optional(),
  start_local: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/),
  end_local: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/)
    .optional()
    .or(z.literal("")),
  origin: PlaceInputSchema.optional(),
  destination: PlaceInputSchema.optional(),
  stops: z.array(PlaceInputSchema).max(MAX_STOPS).optional(),
  vehicle: z.string().trim().max(60).optional(),
  stop_kind: z.enum(STOP_KINDS).optional(),
  details: z.record(z.string(), z.string().max(2000)).optional(),
});
export type CreateSegmentInput = z.infer<typeof CreateSegmentSchema>;

/** A typed address or saved place that has no coordinates. */
function noteUnmapped(place: Place, out: string[]) {
  if (place.lat == null && !place.code) out.push(place.name || place.address || place.city || "A place");
}

export async function buildManualSegment(
  db: SupabaseClient,
  input: CreateSegmentInput,
  deps: PlaceDeps & { geocodeCity: Geocoder },
): Promise<{ values: SegmentValues; reasons: string[] }> {
  const origin = await resolvePlace(db, input.origin, deps);
  const destination = await resolvePlace(db, input.destination, deps);
  const stops: Place[] = [];
  const unmapped: string[] = [];
  for (const r of [origin, destination]) if (r) noteUnmapped(r.place, unmapped);
  for (const s of input.stops ?? []) {
    const r = await resolvePlace(db, s, deps);
    if (r) {
      stops.push(r.place);
      noteUnmapped(r.place, unmapped);
    }
  }

  const startPlace = input.type === "hotel" || input.type === "stop" || input.type === "event" ? destination : origin ?? destination;
  const details: Record<string, unknown> = { ...(input.details ?? {}) };
  if (input.type === "drive") {
    details.stops = stops;
    details.vehicle = input.vehicle || null;
    details.ends_at_home = destination?.kind === "home";
  }
  if (input.type === "stop") {
    details.stop_kind = input.stop_kind ?? "visit";
    details.place_id = input.destination?.place_id ?? null;
    details.address = destination?.place.address ?? null;
  }
  if (input.type === "hotel" && destination?.place.address && !details.address) {
    details.address = destination.place.address;
  }

  const draft: DraftSegment = {
    type: input.type,
    action: "confirmed",
    confirmation_code: input.confirmation_code || null,
    provider: input.provider || null,
    start_local: input.start_local,
    // A place the map could not find has no zone; fall back to the other end,
    // then to home, so the entry is still saved (and flagged below).
    start_tz: startPlace?.tz ?? origin?.tz ?? destination?.tz ?? userTimezone(),
    end_local: input.end_local || null,
    end_tz: (input.type === "hotel" || input.type === "stop" ? destination?.tz : destination?.tz ?? origin?.tz) ?? null,
    origin: origin?.place ?? null,
    destination: destination?.place ?? null,
    details,
    confidence: 1,
  };
  const seg = await finalizeDraft(draft, deps.geocodeCity);
  seg.review_reasons.push(...unmapped.map((p) => `${p} not found on the map; check the address and the time`));
  return {
    reasons: seg.review_reasons,
    values: {
      type: seg.type,
      status: seg.review_reasons.length ? "needs_review" : "confirmed",
      confirmation_code: normalizeCode(seg.confirmation_code),
      provider: seg.provider,
      start_at: seg.start_at,
      start_tz: seg.start_tz,
      end_at: seg.end_at,
      end_tz: seg.end_tz,
      origin: seg.origin,
      destination: seg.destination,
      details: seg.details,
      source_email_id: null,
      confidence: 1,
      review_reasons: seg.review_reasons,
    },
  };
}
