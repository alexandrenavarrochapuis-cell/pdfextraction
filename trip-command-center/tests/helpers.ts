// Shared test helpers: load .eml fixtures, stub the geocoder and Claude.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import PostalMime from "postal-mime";
import type { ClaudeExtraction, ClaudeExtractor } from "@/lib/ingest/claude";
import type { GeoResult, Geocoder } from "@/lib/ingest/draft";
import type { InboundEmail } from "@/lib/ingest/extract";
import type { Segment } from "@/lib/types";

export const FIXTURES = join(__dirname, "..", "fixtures");

export interface LoadedEml {
  email: InboundEmail;
  from: string | null;
  headers: Record<string, string>;
}

export async function loadEml(path: string): Promise<LoadedEml> {
  const parsed = await PostalMime.parse(readFileSync(path));
  const headers: Record<string, string> = {};
  for (const h of parsed.headers) headers[h.key] = headers[h.key] ? `${headers[h.key]}, ${h.value}` : h.value;
  const from = parsed.from && "address" in parsed.from && parsed.from.address
    ? `${parsed.from.name} <${parsed.from.address}>`
    : null;
  return {
    from,
    headers,
    email: {
      subject: parsed.subject ?? null,
      from,
      sentAt: parsed.date ?? null,
      text: parsed.text ?? null,
      html: parsed.html ?? null,
      pdfs: [],
      textAttachments: [],
    },
  };
}

export function synthetic(name: string): string {
  return join(FIXTURES, "synthetic", name);
}

const PLACES: Record<string, GeoResult> = {
  paris: { name: "Paris", country: "FR", lat: 48.8566, lng: 2.3522, tz: "Europe/Paris" },
  nice: { name: "Nice", country: "FR", lat: 43.7102, lng: 7.262, tz: "Europe/Paris" },
  sarasota: { name: "Sarasota", country: "US", lat: 27.3364, lng: -82.5307, tz: "America/New_York" },
};

export const stubGeocoder: Geocoder = async (city) => PLACES[city.toLowerCase()] ?? null;

/** Claude stand-in that replays `<fixture>.claude.json`, or fails the test if it was not expected. */
export function cannedClaude(emlPath: string): ClaudeExtractor & { calls: number } {
  const canned = emlPath.replace(/\.eml$/, ".claude.json");
  const fn = Object.assign(
    async () => {
      fn.calls += 1;
      if (!existsSync(canned)) throw new Error(`Claude was called for ${emlPath} but no canned output exists`);
      return JSON.parse(readFileSync(canned, "utf8")) as ClaudeExtraction;
    },
    { calls: 0 },
  );
  return fn;
}

let nextId = 1;
export function segment(partial: Partial<Segment>): Segment {
  return {
    id: partial.id ?? `seg-${nextId++}`,
    user_id: "user-1",
    trip_id: null,
    type: "flight",
    status: "confirmed",
    confirmation_code: null,
    provider: null,
    start_at: null,
    start_tz: null,
    end_at: null,
    end_tz: null,
    origin: null,
    destination: null,
    details: {},
    source_email_id: null,
    confidence: 1,
    review_reasons: [],
    ...partial,
  };
}
