"""Entry point for the AI strategy news digest.

Runs weekly via GitHub Actions (Mondays 07:00 UTC) with a 170-hour lookback.

Run locally:
    ANTHROPIC_API_KEY=... ZAPIER_WEBHOOK_URL=... \
    python news_digest.py --lookback-hours 170 --top-n 15

Dry-run (no email):
    python news_digest.py --dry-run
"""
from __future__ import annotations

import argparse
import datetime as dt
import logging
import sys

from digest.deliver import post_to_zapier
from digest.fetch import collect
from digest.render import render_html, render_text
from digest.sources import ALL_FEEDS
from digest.summarize import summarize

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("news_digest")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lookback-hours", type=int, default=26,
                        help="Window of items to consider (slight overlap is fine; URLs dedupe).")
    parser.add_argument("--top-n", type=int, default=12)
    parser.add_argument("--dry-run", action="store_true",
                        help="Print the digest, do not POST to Zapier.")
    args = parser.parse_args(argv)

    today = dt.date.today()
    log.info("collecting items from %d feeds (lookback %dh)", len(ALL_FEEDS), args.lookback_hours)
    items = collect(ALL_FEEDS, lookback_hours=args.lookback_hours)
    log.info("collected %d unique items", len(items))

    payload = summarize(items, top_n=args.top_n)
    if not payload.items:
        log.info("no items selected; skipping send")
        return 0

    html_body = render_html(payload, today)
    text_body = render_text(payload, today)
    subject = f"AI Strategy Brief — {today.strftime('%a %b %d')}"

    if args.dry_run:
        print(text_body)
        return 0

    post_to_zapier({
        "subject": subject,
        "html": html_body,
        "text": text_body,
        "date": today.isoformat(),
        "executive_summary": payload.executive_summary,
        "items": payload.items,
    })
    log.info("sent digest: %s (%d items)", subject, len(payload.items))
    return 0


if __name__ == "__main__":
    sys.exit(main())
