"""Fetch and normalize items from RSS/Atom feeds within a lookback window."""
from __future__ import annotations

import datetime as dt
import logging
import time
from dataclasses import dataclass
from typing import Iterable

import feedparser

log = logging.getLogger(__name__)


@dataclass
class Item:
    source: str
    title: str
    url: str
    published: dt.datetime
    summary: str

    def fingerprint(self) -> str:
        return self.url.split("?")[0].rstrip("/").lower()


def _parse_published(entry) -> dt.datetime | None:
    for key in ("published_parsed", "updated_parsed"):
        struct = getattr(entry, key, None) or entry.get(key)
        if struct:
            return dt.datetime.fromtimestamp(time.mktime(struct), tz=dt.timezone.utc)
    return None


def fetch_feed(source: str, url: str, since: dt.datetime) -> list[Item]:
    parsed = feedparser.parse(url, agent="ai-news-digest/1.0")
    if parsed.bozo and not parsed.entries:
        log.warning("feed failed: %s (%s)", source, parsed.bozo_exception)
        return []
    items: list[Item] = []
    for e in parsed.entries:
        published = _parse_published(e)
        if not published or published < since:
            continue
        items.append(Item(
            source=source,
            title=(e.get("title") or "").strip(),
            url=(e.get("link") or "").strip(),
            published=published,
            summary=(e.get("summary") or "").strip(),
        ))
    return items


def collect(feeds: Iterable[tuple[str, str]], lookback_hours: int) -> list[Item]:
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=lookback_hours)
    seen: dict[str, Item] = {}
    for source, url in feeds:
        for item in fetch_feed(source, url, since):
            fp = item.fingerprint()
            if fp and fp not in seen:
                seen[fp] = item
    return sorted(seen.values(), key=lambda i: i.published, reverse=True)
