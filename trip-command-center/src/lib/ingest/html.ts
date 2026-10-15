// Minimal HTML handling for confirmation emails: pull JSON-LD blocks and
// reduce markup to readable text for the extraction prompt.

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rarr: "→",
  euro: "€",
  pound: "£",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  bull: "•",
  middot: "·",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** Raw contents of every <script type="application/ld+json"> block. */
export function extractJsonLdBlocks(html: string): string[] {
  const blocks: string[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) blocks.push(m[1].trim());
  return blocks;
}

export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<(script|style|head|title)\b[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Keep link targets: check-in and manage-booking URLs matter.
  s = s.replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    const label = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!/^https?:/i.test(href)) return ` ${label} `;
    return label ? ` ${label} (${href}) ` : ` ${href} `;
  });
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, "\n");
  s = s.replace(/<(td|th)\b[^>]*>/gi, " | ");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s
    .split("\n")
    .map((line) => line.replace(/[ \t |]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Best plain-text view of an email body. */
export function emailBodyText(text: string | null | undefined, html: string | null | undefined): string {
  const fromHtml = html ? htmlToText(html) : "";
  const plain = (text ?? "").trim();
  // Many senders ship a stub text part ("view this email in your browser").
  if (plain.length >= 200 || !fromHtml) return plain || fromHtml;
  return fromHtml.length > plain.length ? fromHtml : plain;
}
