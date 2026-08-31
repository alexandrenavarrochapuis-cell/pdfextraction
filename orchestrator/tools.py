"""The four orchestration tools the realtime model holds directly.

There is no second LLM between the user's voice and these. Schemas are written
in the shape the OpenAI Realtime API expects for session tools (flat, with
``type: "function"`` at the top level).
"""

from __future__ import annotations

import logging
from typing import Any

from . import config, state, workers

log = logging.getLogger("orchestrator.tools")

SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "spawn_task",
        "description": (
            "Start a background coding agent on a task. The prompt must be "
            "complete and self-contained: the agent cannot hear the "
            "conversation and gets no other context. Returns immediately; the "
            "task runs in its own git worktree."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": (
                        "Full self-contained instruction for the coding agent, "
                        "including which files or areas to touch and what done "
                        "looks like."
                    ),
                },
                "workspace": {
                    "type": "string",
                    "description": (
                        "Which repository to work in. Omit if only one is "
                        "configured. Known: "
                        + (", ".join(sorted(config.WORKSPACES)) or "none")
                    ),
                },
                "label": {
                    "type": "string",
                    "description": (
                        "Three to five word handle the user is likely to say "
                        "out loud when referring to this task later."
                    ),
                },
            },
            "required": ["prompt"],
        },
    },
    {
        "type": "function",
        "name": "check_tasks",
        "description": (
            "List task status from the task store. Call this before answering "
            "any question about what is running. Never answer from memory."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "filter": {
                    "type": "string",
                    "enum": ["active", "recent", "all", "failed"],
                    "description": (
                        "active: queued and running. recent: last handful of "
                        "everything. failed: only failures. Defaults to active."
                    ),
                }
            },
            "required": [],
        },
    },
    {
        "type": "function",
        "name": "followup",
        "description": (
            "Send another turn to a finished task, resuming its existing "
            "session in the same working directory. Use this for corrections "
            "and additions rather than spawning a fresh task."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": "Task label or id, as the user said it.",
                },
                "prompt": {
                    "type": "string",
                    "description": "What the agent should do next.",
                },
            },
            "required": ["task", "prompt"],
        },
    },
    {
        "type": "function",
        "name": "read_result",
        "description": (
            "Fetch the full result text of a finished task. Only call this "
            "when the user asks what a task actually did or said. Do not read "
            "the contents aloud unless asked."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": "Task label or id, as the user said it.",
                },
            },
            "required": ["task"],
        },
    },
]

NAMES = [s["name"] for s in SCHEMAS]


# --- handlers ----------------------------------------------------------------


async def _spawn_task(args: dict[str, Any]) -> dict[str, Any]:
    prompt = (args.get("prompt") or "").strip()
    if not prompt:
        return {"error": "prompt is required"}
    try:
        info = await workers.spawn(
            prompt=prompt,
            workspace=args.get("workspace"),
            label=args.get("label"),
        )
    except KeyError as exc:
        return {
            "error": f"unknown workspace: {exc}",
            "known_workspaces": sorted(config.WORKSPACES),
        }
    except ValueError as exc:
        return {"error": str(exc)}
    running = state.active_count()
    info["note"] = (
        f"started; {min(running, config.MAX_CONCURRENT_WORKERS)} of "
        f"{config.MAX_CONCURRENT_WORKERS} worker slots in use"
    )
    return info


async def _check_tasks(args: dict[str, Any]) -> dict[str, Any]:
    which = (args.get("filter") or "active").lower()
    if which == "active":
        rows = state.list_tasks(state.ACTIVE_STATUSES)
    elif which == "failed":
        rows = state.list_tasks(["failed"], limit=10)
    elif which == "all":
        rows = state.list_tasks(limit=30)
    else:
        rows = state.list_tasks(limit=8)
    return {
        "count": len(rows),
        "max_concurrent": config.MAX_CONCURRENT_WORKERS,
        "tasks": [state.summarize(r) for r in rows],
    }


async def _followup(args: dict[str, Any]) -> dict[str, Any]:
    query = (args.get("task") or "").strip()
    prompt = (args.get("prompt") or "").strip()
    if not prompt:
        return {"error": "prompt is required"}
    task = state.find_task(query)
    if task is None:
        return {"error": f"no task matching {query!r}", "hint": "call check_tasks"}
    try:
        return await workers.followup(task["id"], prompt)
    except ValueError as exc:
        return {"error": str(exc), "label": task["label"], "status": task["status"]}
    except KeyError:
        return {"error": f"task {task['id']} disappeared"}


async def _read_result(args: dict[str, Any]) -> dict[str, Any]:
    query = (args.get("task") or "").strip()
    task = state.find_task(query)
    if task is None:
        return {"error": f"no task matching {query!r}", "hint": "call check_tasks"}
    if task["status"] in state.ACTIVE_STATUSES:
        return {
            "label": task["label"],
            "status": task["status"],
            "note": "still running, no result yet",
        }
    return {
        "label": task["label"],
        "status": task["status"],
        "branch": task["branch"],
        "worktree": task["worktree"],
        "result": (task["result"] or task["error"] or "")[:8000],
    }


HANDLERS = {
    "spawn_task": _spawn_task,
    "check_tasks": _check_tasks,
    "followup": _followup,
    "read_result": _read_result,
}


async def dispatch(name: str, args: dict[str, Any] | None) -> dict[str, Any]:
    """Run one tool call. Never raises --- the model gets an error object."""
    handler = HANDLERS.get(name)
    if handler is None:
        return {"error": f"unknown tool {name!r}", "available": NAMES}
    try:
        result = await handler(args or {})
        log.info("tool %s -> %s", name, str(result)[:200])
        return result
    except Exception as exc:  # noqa: BLE001 - the model must always get a reply
        log.exception("tool %s failed", name)
        return {"error": f"{type(exc).__name__}: {exc}"}
