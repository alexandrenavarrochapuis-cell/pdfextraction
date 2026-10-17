// What the chat screen shows from the stored conversation: the traveler's
// words, Atlas's text and the web sources it cited. Tool calls, their
// results, search results and thinking stay in storage only.

export interface Source {
  title: string;
  url: string;
}

export interface ChatItem {
  role: "user" | "atlas";
  text: string;
  sources: Source[];
}

export interface StoredMessage {
  role: "user" | "assistant";
  content: unknown;
}

/** The per-turn context block Atlas prepends to each message: date, time, location. */
export const CONTEXT_PREFIX = "<context>";

interface Block {
  type?: string;
  text?: string;
  citations?: { type?: string; url?: string; title?: string | null }[] | null;
}

function blocks(content: unknown): Block[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? (content as Block[]) : [];
}

export function toChatItems(messages: StoredMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  for (const m of messages) {
    const content = blocks(m.content);
    if (m.role === "user") {
      const text = content
        .filter((b) => b.type === "text" && b.text && !b.text.startsWith(CONTEXT_PREFIX))
        .map((b) => b.text)
        .join("\n");
      // A user message holding only tool results continues Atlas's turn.
      if (text) items.push({ role: "user", text, sources: [] });
      continue;
    }
    let item = items.at(-1);
    if (!item || item.role !== "atlas") {
      item = { role: "atlas", text: "", sources: [] };
      items.push(item);
    }
    for (const b of content) {
      if (b.type === "text" && b.text) {
        item.text += b.text;
        for (const c of b.citations ?? []) {
          if (c.url && !item.sources.some((s) => s.url === c.url)) item.sources.push({ title: c.title || c.url, url: c.url });
        }
      }
    }
  }
  return items;
}
