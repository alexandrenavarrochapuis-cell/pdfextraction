// Save a boarding pass file (Wallet .pkpass, PDF or screenshot), read what it
// says, and link it to a flight and a traveler.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Segment, Traveler } from "../types";
import { parseBcbp } from "./bcbp";
import { factsFromBcbp, matchSegment, matchTraveler, type PassFacts } from "./match";
import { readPkpass } from "./pkpass";

export const PASS_BUCKET = "boarding-passes";
export const PKPASS_TYPE = "application/vnd.apple.pkpass";

export function passKind(contentType: string, filename: string | null): "wallet" | "pdf" | "image" | null {
  const name = (filename ?? "").toLowerCase();
  if (contentType === PKPASS_TYPE || name.endsWith(".pkpass")) return "wallet";
  if (contentType === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (contentType.startsWith("image/")) return "image";
  return null;
}

export interface SavePassInput {
  userId: string;
  bytes: Uint8Array;
  filename: string | null;
  contentType: string;
  segmentId?: string | null;
  travelerId?: string | null;
  sourceEmailId?: string | null;
  /** Details already known, e.g. read by Claude from a PDF pass. */
  facts?: PassFacts;
  reference?: Date;
}

export async function saveBoardingPass(db: SupabaseClient, input: SavePassInput): Promise<string | null> {
  const kind = passKind(input.contentType, input.filename);
  if (!kind) return null;
  const reference = input.reference ?? new Date();
  let facts: PassFacts = { ...input.facts };
  let barcodeMessage: string | null = null;
  let barcodeFormat: string | null = null;
  let gate: string | null = null;
  let group: string | null = null;
  let boardingTime: string | null = null;

  if (kind === "wallet") {
    const pass = readPkpass(input.bytes);
    if (pass) {
      barcodeMessage = pass.barcodeMessage;
      barcodeFormat = pass.barcodeFormat;
      gate = pass.gate;
      group = pass.boardingGroup;
      boardingTime = pass.boardingTime;
      const bcbp = pass.barcodeMessage ? parseBcbp(pass.barcodeMessage) : null;
      const relevant = pass.relevantDate ? new Date(pass.relevantDate) : reference;
      facts = {
        ...(bcbp ? factsFromBcbp(bcbp, Number.isNaN(relevant.getTime()) ? reference : relevant) : {}),
        ...facts,
        seat: facts.seat ?? pass.seat ?? (bcbp ? factsFromBcbp(bcbp, reference).seat : null),
        passengerName: facts.passengerName ?? bcbp?.passengerName ?? pass.passengerName,
      };
    }
  }

  let segmentId = input.segmentId ?? null;
  let travelerId = input.travelerId ?? null;
  if (!segmentId || !travelerId) {
    const [{ data: segs }, { data: travelers }] = await Promise.all([
      db.from("segments").select("*").eq("user_id", input.userId).eq("type", "flight"),
      db.from("travelers").select("*").eq("user_id", input.userId),
    ]);
    segmentId ??= matchSegment(facts, (segs ?? []) as Segment[])?.id ?? null;
    travelerId ??= matchTraveler(facts.passengerName, (travelers ?? []) as Traveler[])?.id ?? null;
  }

  const safe = (input.filename ?? `pass.${kind === "wallet" ? "pkpass" : kind === "pdf" ? "pdf" : "img"}`).replace(/[^\w.-]+/g, "_");
  const path = `${input.userId}/${crypto.randomUUID()}-${safe}`;
  const contentType = kind === "wallet" ? PKPASS_TYPE : input.contentType;
  const { error: upErr } = await db.storage.from(PASS_BUCKET).upload(path, input.bytes, { contentType });
  if (upErr) throw upErr;

  const { data, error } = await db
    .from("boarding_passes")
    .insert({
      user_id: input.userId,
      segment_id: segmentId,
      traveler_id: travelerId,
      passenger_name: facts.passengerName ?? null,
      kind,
      storage_path: path,
      content_type: contentType,
      barcode_message: barcodeMessage,
      barcode_format: barcodeFormat,
      carrier: facts.carrier ?? null,
      flight_number: facts.flightNumber ?? null,
      flight_date: facts.date ?? null,
      origin: facts.from ?? null,
      destination: facts.to ?? null,
      seat: facts.seat ?? null,
      boarding_group: group,
      boarding_time: boardingTime,
      gate,
      source_email_id: input.sourceEmailId ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}
