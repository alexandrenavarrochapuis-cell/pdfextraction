"""Background poll loop that tells the voice session when a task finishes.

Announcements are queued, never barged in. Talking over the user is the same
failure as failing to barge in --- both make the thing feel like it is not
listening.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Protocol

from . import config, state

log = logging.getLogger("orchestrator.notifier")


class Session(Protocol):
    connected: asyncio.Event

    def busy(self) -> bool: ...

    async def announce(self, text: str) -> None: ...


def phrase(task: dict[str, Any]) -> str:
    """The system message handed to the model. It decides the wording."""
    label = task["label"]
    if task["status"] == "done":
        outcome = (task.get("result") or "").strip().replace("\n", " ")
        if len(outcome) > 400:
            outcome = outcome[:400] + "..."
        return (
            f"A background task just finished. Label: {label}. It succeeded. "
            f"Its summary was: {outcome or 'no summary given'}. "
            "Tell the user the label and one sentence of outcome, then stop."
        )
    error = (task.get("error") or "").strip().replace("\n", " ")
    if len(error) > 400:
        error = error[:400] + "..."
    return (
        f"A background task just failed. Label: {label}. The error was: "
        f"{error or 'no error text'}. Say plainly that it failed and offer the "
        "error. Do not narrate a recovery plan unless the user asks."
    )


async def run(session: Session, interval: float | None = None) -> None:
    """Poll for finished-but-unannounced tasks and speak them up."""
    interval = config.NOTIFY_INTERVAL_SECONDS if interval is None else interval
    if config.NOTIFY_MODE != "on_complete":
        log.info("notifier: %s mode, staying quiet", config.NOTIFY_MODE)
        return

    pending: list[dict[str, Any]] = []
    await session.connected.wait()
    log.info("notifier: polling every %.1fs", interval)

    while True:
        await asyncio.sleep(interval)

        for task in state.unannounced_finished():
            # Marked here, not after speaking: the announcement is now this
            # loop's responsibility, and a task must never be announced twice.
            state.mark_announced(task["id"])
            pending.append(task)

        if not pending:
            continue

        # Do not interrupt mid-utterance. Hold the queue until the turn closes.
        if session.busy():
            continue

        task = pending.pop(0)
        log.info("announcing %s (%s)", task["label"], task["status"])
        try:
            await session.announce(phrase(task))
        except Exception as exc:  # noqa: BLE001
            log.warning("could not announce %s: %s", task["label"], exc)
            pending.insert(0, task)
            await asyncio.sleep(interval)
