// Atlas's turn: stream Claude's answer, run the tools it asks for, and repeat
// until it is done. The conversation is append-only: every assistant message
// goes back unchanged on the next request (thinking blocks included), and
// nothing earlier is ever edited or dropped.

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { ASSISTANT_MODEL } from "../config";
import { runTool, toolStatus, TOOLS, type AtlasAction, type ToolContext } from "./tools";
import type { Source } from "./transcript";

export type AtlasEvent =
  | { t: "status"; text: string }
  | { t: "text"; d: string }
  | { t: "action"; action: AtlasAction }
  | { t: "sources"; sources: Source[] }
  | { t: "error"; text: string }
  | { t: "done"; conversation_id: string };

const MAX_STEPS = 12;

export async function runAtlas(
  client: Anthropic,
  opts: {
    system: Anthropic.Beta.BetaTextBlockParam[];
    history: Anthropic.Beta.BetaMessageParam[];
    ctx: Omit<ToolContext, "onAction">;
    emit: (event: AtlasEvent) => void;
  },
): Promise<Anthropic.Beta.BetaMessageParam[]> {
  const messages = [...opts.history];
  const added: Anthropic.Beta.BetaMessageParam[] = [];
  const push = (m: Anthropic.Beta.BetaMessageParam) => {
    messages.push(m);
    added.push(m);
  };
  const ctx: ToolContext = { ...opts.ctx, onAction: (action) => opts.emit({ t: "action", action }) };
  const sources = new Map<string, Source>();
  let jsonRetries = 0;

  for (let step = 0; step < MAX_STEPS; step++) {
    const stream = client.beta.messages.stream({
      model: ASSISTANT_MODEL,
      max_tokens: 32000,
      // Route a declined request to another model instead of stopping.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      system: opts.system,
      tools: TOOLS,
      messages,
    });

    let message: Anthropic.Beta.BetaMessage;
    try {
      for await (const event of stream) {
        if (event.type === "content_block_start") {
          const block = event.content_block;
          if (block.type === "server_tool_use" || block.type === "tool_use") opts.emit({ t: "status", text: toolStatus(block.name) });
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          opts.emit({ t: "text", d: event.delta.text });
        }
      }
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // Streamed tool inputs are not validated by the server; a turn whose
      // input could not be parsed at all is re-issued. API errors are not.
      if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
      continue;
    }

    for (const block of message.content) {
      if (block.type !== "text") continue;
      for (const c of block.citations ?? []) {
        if (c.type === "web_search_result_location" && !sources.has(c.url)) sources.set(c.url, { title: c.title ?? c.url, url: c.url });
      }
    }

    if (message.stop_reason === "refusal") {
      if (message.content.length) push({ role: "assistant", content: message.content });
      opts.emit({ t: "text", d: "\n\nI can't help with that one." });
      break;
    }
    if (message.stop_reason === "pause_turn") {
      // A long server-tool turn paused; send it back as is to continue.
      push({ role: "assistant", content: message.content });
      continue;
    }

    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    push({ role: "assistant", content: message.content });
    if (!toolUses.length) break;

    if (message.stop_reason === "max_tokens") {
      // A tool input cut off mid-way may still parse; never run it.
      push({
        role: "user",
        content: toolUses.map((tu) => ({
          type: "tool_result" as const,
          tool_use_id: tu.id,
          is_error: true,
          content: "The request was cut off before it finished; ask for less at once.",
        })),
      });
      continue;
    }

    const results = await Promise.all(toolUses.map((tu) => runTool(tu, ctx)));
    push({ role: "user", content: results });
  }

  if (sources.size) opts.emit({ t: "sources", sources: [...sources.values()] });
  return added;
}
