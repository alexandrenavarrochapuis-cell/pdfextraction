// Two-step Claude research: (1) research with the web search tool, resuming
// paused turns; (2) turn the notes into a fixed JSON shape with structured
// output. Structured output cannot be combined with web search citations in
// one request, hence the second pass.

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type * as z from "zod/v4";
import { ASSISTANT_MODEL } from "../config";

export interface Source {
  title: string;
  url: string;
}

export interface ResearchNotes {
  text: string;
  sources: Source[];
}

const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
const MAX_RESUMES = 6;

export async function research(
  client: Anthropic,
  opts: { system: string; prompt: string; allowedDomains?: string[]; maxSearches?: number },
): Promise<ResearchNotes> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.prompt }];
  const texts: string[] = [];
  const sources = new Map<string, Source>();

  for (let i = 0; i < MAX_RESUMES; i++) {
    const stream = client.beta.messages.stream({
      model: ASSISTANT_MODEL,
      max_tokens: 32000,
      ...FALLBACK,
      output_config: { effort: "high" },
      system: opts.system,
      tools: [
        {
          type: "web_search_20260209",
          name: "web_search",
          max_uses: opts.maxSearches ?? 12,
          ...(opts.allowedDomains ? { allowed_domains: opts.allowedDomains } : {}),
        },
      ],
      messages,
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") {
      throw new Error(`Research declined (${message.stop_details?.category ?? "no category"})`);
    }
    for (const block of message.content) {
      if (block.type === "text") {
        texts.push(block.text);
        for (const c of block.citations ?? []) {
          if (c.type === "web_search_result_location") sources.set(c.url, { title: c.title ?? c.url, url: c.url });
        }
      } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) if (!sources.has(r.url)) sources.set(r.url, { title: r.title, url: r.url });
      }
    }
    if (message.stop_reason !== "pause_turn") break;
    // Resume a paused server-tool turn by sending the partial turn back as is.
    messages.push({ role: "assistant", content: message.content });
  }
  return { text: texts.join("").trim(), sources: [...sources.values()] };
}

export async function structure<T extends z.ZodType>(
  client: Anthropic,
  schema: T,
  instructions: string,
  notes: ResearchNotes,
): Promise<z.infer<T>> {
  const sourceList = notes.sources.map((s, i) => `[${i + 1}] ${s.title} - ${s.url}`).join("\n");
  const response = await client.beta.messages.parse({
    model: ASSISTANT_MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: "low", format: betaZodOutputFormat(schema) },
    system: `${instructions}\nUse only facts stated in the research notes. Use null or an empty list when the notes do not say. Copy source URLs exactly from the source list.`,
    messages: [
      {
        role: "user",
        content: `<research_notes>\n${notes.text}\n</research_notes>\n<sources>\n${sourceList}\n</sources>`,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("Structuring declined");
  if (!response.parsed_output) throw new Error("Structuring returned no output");
  return response.parsed_output as z.infer<T>;
}
