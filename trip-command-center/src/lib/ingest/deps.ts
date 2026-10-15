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
    claude: createClaudeExtractor(new Anthropic()),
    geocode: cachedGeocoder(openMeteoGeocoder),
  };
}
