// A trip item Atlas adds when asked (a flight just booked, a hotel, a drive),
// in the simple shape the model fills in, mapped to the /api/segments input.

import * as z from "zod";
import type { CreateSegmentInput } from "../trips/create";

export const TripItemSchema = z.object({
  type: z.enum(["flight", "hotel", "drive", "train", "car", "event", "stop"]),
  summary: z.string().trim().min(1).max(200),
  start_local: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/),
  end_local: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/)
    .optional(),
  from: z.string().trim().max(300).optional(),
  to: z.string().trim().max(300).optional(),
  provider: z.string().trim().max(120).optional(),
  confirmation_code: z.string().trim().max(40).optional(),
  flight_number: z.string().trim().max(12).optional(),
  property_name: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});
export type TripItem = z.infer<typeof TripItemSchema>;

const IATA = /^[A-Za-z]{3}$/;

/** The /api/segments body for an item. */
export function tripItemToSegment(p: TripItem): CreateSegmentInput {
  const details: Record<string, string> = {};
  if (p.flight_number) details.flight_number = p.flight_number;
  if (p.property_name) details.property_name = p.property_name;
  if (p.note) details.note = p.note;
  const base = {
    type: p.type,
    provider: p.provider,
    confirmation_code: p.confirmation_code,
    start_local: p.start_local,
    end_local: p.end_local,
    details,
  };
  switch (p.type) {
    case "flight":
      return {
        ...base,
        origin: p.from ? (IATA.test(p.from) ? { code: p.from.toUpperCase() } : { city: p.from }) : undefined,
        destination: p.to ? (IATA.test(p.to) ? { code: p.to.toUpperCase() } : { city: p.to }) : undefined,
      };
    case "train":
      return { ...base, origin: p.from ? { city: p.from } : undefined, destination: p.to ? { city: p.to } : undefined };
    case "drive":
    case "car":
      return { ...base, origin: p.from ? { address: p.from } : undefined, destination: p.to ? { address: p.to } : undefined };
    default:
      // Stays, stops and events have one place, kept as the destination.
      return { ...base, destination: (p.to ?? p.from) ? { address: (p.to ?? p.from)!, label: p.property_name } : undefined };
  }
}
