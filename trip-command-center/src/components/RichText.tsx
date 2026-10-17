// A small, safe renderer for Atlas's replies: paragraphs, bullet and numbered
// lists, headings, **bold**, [links](url) and bare URLs. It builds React
// elements; nothing is injected as HTML. Links go only to the web (https) or
// to pages inside the app.

import Link from "next/link";
import type { ReactNode } from "react";

const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)<>]+)/g;

function safeHref(href: string): string | null {
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "tel:" ? url.href : null;
  } catch {
    return null;
  }
}

function anchor(text: string, href: string, key: string): ReactNode {
  const safe = safeHref(href);
  if (!safe) return text;
  const cls = "font-semibold text-accent underline decoration-2 underline-offset-2";
  return safe.startsWith("/") ? (
    <Link key={key} href={safe} className={cls}>
      {text}
    </Link>
  ) : (
    <a key={key} href={safe} target={safe.startsWith("tel:") ? undefined : "_blank"} rel="noreferrer" className={cls}>
      {text}
    </a>
  );
}

function inline(text: string, prefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${prefix}-${i++}`;
    if (m[1]) out.push(<strong key={key}>{m[1]}</strong>);
    else if (m[2] && m[3]) out.push(anchor(m[2], m[3], key));
    else if (m[4]) out.push(anchor(m[4].replace(/[.,;:]$/, ""), m[4].replace(/[.,;:]$/, ""), key));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text }: { text: string }) {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((block, b) => {
        const lines = block.split("\n").filter((l) => l.trim());
        if (!lines.length) return null;
        if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
          const ordered = /^\s*\d/.test(lines[0]);
          const List = ordered ? "ol" : "ul";
          return (
            <List key={b} className={`space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
              {lines.map((l, i) => (
                <li key={i}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""), `${b}-${i}`)}</li>
              ))}
            </List>
          );
        }
        if (lines.length === 1 && /^#{1,4}\s/.test(lines[0])) {
          return (
            <p key={b} className="pt-1 text-lg font-bold">
              {inline(lines[0].replace(/^#{1,4}\s/, ""), `${b}`)}
            </p>
          );
        }
        return (
          <p key={b}>
            {lines.map((l, i) => (
              <span key={i}>
                {i ? <br /> : null}
                {inline(l.replace(/^#{1,4}\s/, ""), `${b}-${i}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
