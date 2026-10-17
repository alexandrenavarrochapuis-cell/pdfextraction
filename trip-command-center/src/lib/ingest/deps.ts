// Production wiring for the ingest pipeline.

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { Resend } from "resend";
import { cachedGeocoder, openMeteoGeocoder } from "../geo";
import { createClaudeExtractor } from "./claude";
import type { ExtractDeps } from "./extract";

export function createResend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  return new Resend(key);
}

export function createExtractDeps(): ExtractDeps {
  return {
    // Inside the routes' 300-second limit, leaving time to record a failure.
    claude: createClaudeExtractor(new Anthropic({ timeout: 200_000, maxRetries: 1 })),
    geocode: cachedGeocoder(openMeteoGeocoder),
  };
}
