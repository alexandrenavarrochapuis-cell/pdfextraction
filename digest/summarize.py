"""Rank and summarize news items with Claude, with a Head-of-AI-Strategy lens."""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Iterable

from anthropic import Anthropic

from .fetch import Item

log = logging.getLogger(__name__)

MODEL = os.environ.get("DIGEST_MODEL", "claude-haiku-4-5")
MAX_ITEMS_IN = 80
MAX_ITEMS_OUT = 12

SYSTEM = """You are an analyst preparing a daily AI news brief for the Head of \
AI Strategy at an enterprise. Your job: pick the items that genuinely change \
what they should think about, and write them up in 2-3 punchy sentences each.

Score every item on strategic relevance:
  - frontier model capabilities and benchmarks
  - regulation, policy, and antitrust moves
  - major funding, M&A, and enterprise deals
  - infrastructure and compute supply
  - shifts in the competitive landscape between labs
  - safety incidents or disclosed misuse

De-prioritize: routine product UI updates, minor integrations, opinion \
pieces, hype with no substance, duplicate coverage of the same event.

For each selected item write:
  - a one-line headline (rewrite if the original is clickbait)
  - a 2-3 sentence "so what" framing that makes the strategic implication explicit
  - 1-3 short tags

Return STRICT JSON. No markdown, no preamble."""

USER_TEMPLATE = """Today's candidate items ({n}):

{items_json}

Pick the top {top_n} by strategic relevance for a Head of AI Strategy. \
Return JSON with this exact shape:

{{
  "executive_summary": "2-3 sentences on the day's overall signal",
  "items": [
    {{
      "headline": "...",
      "so_what": "...",
      "tags": ["..."],
      "source": "...",
      "url": "...",
      "published": "ISO8601"
    }}
  ]
}}"""


@dataclass
class DigestPayload:
    executive_summary: str
    items: list[dict]


def summarize(items: Iterable[Item], top_n: int = MAX_ITEMS_OUT) -> DigestPayload:
    candidates = list(items)[:MAX_ITEMS_IN]
    if not candidates:
        return DigestPayload(
            executive_summary="No new items in the lookback window.",
            items=[],
        )

    items_json = json.dumps([
        {
            "source": i.source,
            "title": i.title,
            "url": i.url,
            "published": i.published.isoformat(),
            "summary": i.summary[:600],
        }
        for i in candidates
    ], ensure_ascii=False)

    client = Anthropic()
    resp = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        system=[
            {
                "type": "text",
                "text": SYSTEM,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[
            {
                "role": "user",
                "content": USER_TEMPLATE.format(
                    n=len(candidates),
                    items_json=items_json,
                    top_n=top_n,
                ),
            }
        ],
    )
    text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text").strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        log.error("model did not return valid JSON: %s", text[:400])
        raise
    return DigestPayload(
        executive_summary=data.get("executive_summary", "").strip(),
        items=data.get("items", []),
    )
