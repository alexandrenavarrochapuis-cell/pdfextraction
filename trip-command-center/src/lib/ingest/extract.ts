// Turn one email into extracted segments: schema.org markup first, Claude
// otherwise (spec section 3, step 5).

import type { ExtractedSegment } from "../types";
import { claudeToDrafts, type ClaudeExtraction, type ClaudeExtractor, type EmailForExtraction } from "./claude";
import { finalizeDraft, type DraftSegment, type Geocoder } from "./draft";
import { emailBodyText } from "./html";
import { parseJsonLdReservations } from "./jsonld";

export interface InboundEmail {
  subject: string | null;
  from: string | null;
  sentAt: string | null;
  text: string | null;
  html: string | null;
  pdfs: EmailForExtraction["pdfs"];
  textAttachments: EmailForExtraction["textAttachments"];
}

export interface ExtractionResult {
  method: "jsonld" | "claude";
  isTravel: boolean;
  segments: ExtractedSegment[];
  /** Boarding passes Claude found in PDF attachments. */
  boardingPasses: ClaudeExtraction["boarding_passes"];
}

export interface ExtractDeps {
  claude: ClaudeExtractor;
  geocode: Geocoder;
}

/** Markup is usable when every reservation it describes has the fields a timeline needs. */
function markupIsComplete(segments: ExtractedSegment[]): boolean {
  return segments.length > 0 && segments.every((s) => s.review_reasons.length === 0);
}

async function finalizeAll(drafts: DraftSegment[], geocode: Geocoder): Promise<ExtractedSegment[]> {
  const out: ExtractedSegment[] = [];
  for (const d of drafts) out.push(await finalizeDraft(d, geocode));
  return out;
}

export async function extractSegments(email: InboundEmail, deps: ExtractDeps): Promise<ExtractionResult> {
  const fromMarkup = await finalizeAll(parseJsonLdReservations(email.html), deps.geocode);
  if (markupIsComplete(fromMarkup)) {
    return { method: "jsonld", isTravel: true, segments: fromMarkup, boardingPasses: [] };
  }

  const result = await deps.claude({
    subject: email.subject,
    from: email.from,
    sentAt: email.sentAt,
    bodyText: emailBodyText(email.text, email.html),
    pdfs: email.pdfs,
    textAttachments: email.textAttachments,
  });
  const segments = await finalizeAll(claudeToDrafts(result), deps.geocode);
  return {
    method: "claude",
    isTravel: result.is_travel_confirmation,
    segments,
    boardingPasses: result.boarding_passes ?? [],
  };
}
