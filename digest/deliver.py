"""Send the rendered digest to a Zapier 'Catch Hook' webhook.

The Zap on the other end is configured to take the JSON payload and call
Gmail → Send Email with the connected account.
"""
from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request

log = logging.getLogger(__name__)


def post_to_zapier(payload: dict, webhook_url: str | None = None, timeout: int = 30) -> int:
    url = webhook_url or os.environ["ZAPIER_WEBHOOK_URL"]
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            log.info("zapier accepted: %s", resp.status)
            return resp.status
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"zapier webhook {e.code}: {body}") from e
