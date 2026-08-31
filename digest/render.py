"""Render the digest payload as both HTML (for email) and plain text."""
from __future__ import annotations

import datetime as dt
import html

from .summarize import DigestPayload


def _fmt_date(iso: str) -> str:
    try:
        return dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%b %d")
    except ValueError:
        return ""


def render_html(payload: DigestPayload, date: dt.date) -> str:
    parts = [
        "<!doctype html><html><body style=\"font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:680px;margin:0 auto;padding:24px;color:#111\">",
        f"<h1 style=\"margin:0 0 4px 0;font-size:22px\">AI Strategy Brief — {date.strftime('%A, %B %d, %Y')}</h1>",
        "<div style=\"color:#666;font-size:13px;margin-bottom:20px\">Curated for the Head of AI Strategy</div>",
    ]
    if payload.executive_summary:
        parts.append(
            "<div style=\"background:#f6f8fa;border-left:3px solid #0a66c2;padding:12px 14px;border-radius:4px;margin-bottom:24px\">"
            f"<div style=\"font-weight:600;font-size:13px;color:#0a66c2;margin-bottom:6px\">TODAY'S SIGNAL</div>"
            f"<div>{html.escape(payload.executive_summary)}</div>"
            "</div>"
        )
    for i, item in enumerate(payload.items, 1):
        tags = "".join(
            f"<span style=\"display:inline-block;background:#eef;color:#334;border-radius:10px;padding:1px 8px;font-size:11px;margin-right:4px\">{html.escape(t)}</span>"
            for t in item.get("tags", [])
        )
        meta_bits = [html.escape(item.get("source", ""))]
        if d := _fmt_date(item.get("published", "")):
            meta_bits.append(d)
        parts.append(
            "<div style=\"margin-bottom:22px;padding-bottom:18px;border-bottom:1px solid #eee\">"
            f"<div style=\"font-size:12px;color:#888;margin-bottom:4px\">{i:02d} &middot; {' &middot; '.join(meta_bits)}</div>"
            f"<a href=\"{html.escape(item.get('url', '#'))}\" style=\"font-size:17px;font-weight:600;color:#0a66c2;text-decoration:none\">{html.escape(item.get('headline', ''))}</a>"
            f"<div style=\"margin-top:6px;line-height:1.5\">{html.escape(item.get('so_what', ''))}</div>"
            f"<div style=\"margin-top:8px\">{tags}</div>"
            "</div>"
        )
    parts.append(
        "<div style=\"color:#999;font-size:11px;margin-top:8px\">Sent by the ai-news-digest GitHub Action. Edit sources in <code>digest/sources.py</code>.</div>"
        "</body></html>"
    )
    return "".join(parts)


def render_text(payload: DigestPayload, date: dt.date) -> str:
    lines = [f"AI Strategy Brief — {date.strftime('%A, %B %d, %Y')}", ""]
    if payload.executive_summary:
        lines += ["TODAY'S SIGNAL", payload.executive_summary, ""]
    for i, item in enumerate(payload.items, 1):
        meta = item.get("source", "")
        if d := _fmt_date(item.get("published", "")):
            meta = f"{meta} · {d}"
        lines += [
            f"{i:02d}. {item.get('headline', '')}",
            f"    {meta}",
            f"    {item.get('so_what', '')}",
            f"    {item.get('url', '')}",
            "",
        ]
    return "\n".join(lines)
