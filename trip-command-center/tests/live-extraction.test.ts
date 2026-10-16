// Real confirmation emails through the full extraction path against the live
// Claude API and the Open-Meteo geocoder (fixtures/README.md). Skipped unless
// run with `npm run test:live`, which sets RUN_LIVE_EXTRACTION=1.
//
// Each fixtures/real/<name>.eml is extracted and the result is written to
// <name>.extracted.json in the expected-file shape. When <name>.expected.json
// exists, every segment it lists must match one extracted segment on the
// fields it gives, and the segment counts must agree.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClaudeExtractor } from "@/lib/ingest/claude";
import { extractSegments, type ExtractDeps } from "@/lib/ingest/extract";
import { cachedGeocoder, openMeteoGeocoder } from "@/lib/geo";
import type { ExtractedSegment, Place } from "@/lib/types";
import { FIXTURES, loadEml } from "./helpers";

const RUN = process.env.RUN_LIVE_EXTRACTION === "1";
const REAL = join(FIXTURES, "real");
const files = existsSync(REAL) ? readdirSync(REAL).filter((f) => f.endsWith(".eml")).sort() : [];

type Expected = { is_travel?: boolean; segments?: Record<string, unknown>[] };

const TOP_LEVEL = new Set(["type", "action", "confirmation_code", "provider", "start_tz", "end_tz"]);
const INSTANTS = new Set(["start_at", "end_at"]);

function placeKey(place: Place | null): string | null {
  return place?.code ?? place?.city ?? place?.name ?? null;
}

function norm(value: unknown): unknown {
  return typeof value === "string" ? value.toUpperCase().replace(/\s+/g, "") : value;
}

function fieldMatches(seg: ExtractedSegment, key: string, want: unknown): boolean {
  if (INSTANTS.has(key)) {
    const got = seg[key as "start_at" | "end_at"];
    return want === null ? got === null : got !== null && Date.parse(got) === Date.parse(String(want));
  }
  if (key === "origin" || key === "destination") return norm(placeKey(seg[key])) === norm(want);
  const got = TOP_LEVEL.has(key)
    ? seg[key as keyof ExtractedSegment]
    : (seg.details as Record<string, unknown>)[key];
  return JSON.stringify(norm(got ?? null)) === JSON.stringify(norm(want));
}

/** The extracted segments in the expected-file shape, for review and reuse. */
function summarize(segments: ExtractedSegment[]): Record<string, unknown>[] {
  return segments.map((s) => ({
    type: s.type,
    action: s.action,
    confirmation_code: s.confirmation_code,
    provider: s.provider,
    ...(s.details.flight_number ? { flight_number: s.details.flight_number } : {}),
    ...(s.details.property_name ? { property_name: s.details.property_name } : {}),
    origin: placeKey(s.origin),
    destination: placeKey(s.destination),
    start_at: s.start_at,
    start_tz: s.start_tz,
    end_at: s.end_at,
    end_tz: s.end_tz,
    ...(s.review_reasons.length ? { review_reasons: s.review_reasons } : {}),
  }));
}

describe.skipIf(!RUN)("live extraction over fixtures/real", () => {
  // Built lazily so a normal `npm test` never constructs an API client.
  let deps: ExtractDeps | null = null;
  function liveDeps(): ExtractDeps {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY to run the live extraction test.");
    deps ??= { claude: createClaudeExtractor(), geocode: cachedGeocoder(openMeteoGeocoder) };
    return deps;
  }

  it("has real fixtures to run", () => {
    expect(files.length, "Add .eml files to fixtures/real/ (see fixtures/README.md)").toBeGreaterThan(0);
  });

  for (const file of files) {
    it(file, { timeout: 180_000 }, async () => {
      const { email } = await loadEml(join(REAL, file));
      const result = await extractSegments(email, liveDeps());
      const extracted = {
        method: result.method,
        is_travel: result.isTravel,
        boarding_passes: result.boardingPasses.length,
        segments: summarize(result.segments),
      };
      writeFileSync(join(REAL, file.replace(/\.eml$/, ".extracted.json")), `${JSON.stringify(extracted, null, 2)}\n`);
      console.log(`${file}: ${result.method}, ${result.segments.length} segment(s)\n${JSON.stringify(extracted.segments, null, 2)}`);

      const expectedPath = join(REAL, file.replace(/\.eml$/, ".expected.json"));
      if (!existsSync(expectedPath)) return;
      const expected = JSON.parse(readFileSync(expectedPath, "utf8")) as Expected;

      if (expected.is_travel !== undefined) expect(result.isTravel).toBe(expected.is_travel);
      if (!expected.segments) return;
      expect(result.segments, "segment count").toHaveLength(expected.segments.length);
      const unmatched = [...result.segments];
      for (const want of expected.segments) {
        const i = unmatched.findIndex((seg) => Object.entries(want).every(([k, v]) => fieldMatches(seg, k, v)));
        expect(i, `no extracted segment matches ${JSON.stringify(want)}`).toBeGreaterThanOrEqual(0);
        unmatched.splice(i, 1);
      }
    });
  }
});
