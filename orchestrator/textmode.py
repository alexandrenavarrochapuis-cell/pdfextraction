"""Keyboard-driven front end over the same tool loop the voice layer uses.

This is the debugging path: everything below the tool boundary --- worker
spawning, worktree isolation, the concurrency semaphore, session resume --- is
exercised here without a microphone in the way.
"""

from __future__ import annotations

import asyncio
import json
import shlex
import sys
from typing import Any

from . import config, state, tools

HELP = """commands
  spawn [workspace] <label> :: <prompt>   start a task
  check [active|recent|all|failed]        list task status
  followup <task> :: <prompt>             resume a finished task
  result <task>                           print a task's full result
  raw <json>                              {"tool": "...", "args": {...}}
  watch                                   block until every task finishes
  help                                    this
  quit                                    exit (running workers are killed)
"""


def _print(payload: Any) -> None:
    if isinstance(payload, (dict, list)):
        print(json.dumps(payload, indent=2, ensure_ascii=False, default=str))
    else:
        print(payload)


def parse(line: str) -> tuple[str, dict[str, Any]] | None:
    """Map a typed line onto a tool call."""
    line = line.strip()
    if not line:
        return None
    verb, _, rest = line.partition(" ")
    verb = verb.lower()
    rest = rest.strip()

    if verb == "spawn":
        head, sep, prompt = rest.partition("::")
        if not sep:
            raise ValueError("spawn needs '::' between the label and the prompt")
        parts = shlex.split(head.strip()) if head.strip() else []
        workspace = None
        if len(parts) > 1 and parts[0] in config.WORKSPACES:
            workspace = parts[0]
            parts = parts[1:]
        label = " ".join(parts) or None
        return "spawn_task", {
            "prompt": prompt.strip(),
            "label": label,
            "workspace": workspace,
        }
    if verb == "check":
        return "check_tasks", {"filter": rest or "active"}
    if verb == "followup":
        head, sep, prompt = rest.partition("::")
        if not sep:
            raise ValueError("followup needs '::' between the task and the prompt")
        return "followup", {"task": head.strip(), "prompt": prompt.strip()}
    if verb == "result":
        return "read_result", {"task": rest}
    if verb == "raw":
        payload = json.loads(rest)
        return payload["tool"], payload.get("args", {})
    raise ValueError(f"unknown command {verb!r}; try 'help'")


async def _readline(prompt: str) -> str:
    """Read stdin without blocking the loop, so workers keep progressing."""
    return await asyncio.to_thread(_blocking_input, prompt)


def _blocking_input(prompt: str) -> str:
    try:
        return input(prompt)
    except EOFError:
        return "quit"


async def _watch() -> None:
    while True:
        rows = state.list_tasks(state.ACTIVE_STATUSES)
        if not rows:
            print("no active tasks")
            return
        print(
            "waiting on "
            + ", ".join(f"{r['label']} [{r['status']}]" for r in rows)
        )
        await asyncio.sleep(2)


async def run(stream_help: bool = True) -> None:
    if stream_help:
        print(HELP)
        print(
            f"workspaces: {', '.join(sorted(config.WORKSPACES)) or 'none configured'}"
            f" | max concurrent: {config.MAX_CONCURRENT_WORKERS}"
            f" | model: {config.WORKER_MODEL}"
        )
    interactive = sys.stdin.isatty()
    while True:
        line = await _readline("> " if interactive else "")
        cmd = line.strip()
        if not cmd:
            continue
        if cmd in ("quit", "exit"):
            return
        if cmd == "help":
            print(HELP)
            continue
        if cmd == "watch":
            await _watch()
            continue
        if not interactive:
            print(f"> {cmd}")
        try:
            parsed = parse(cmd)
        except (ValueError, json.JSONDecodeError, KeyError) as exc:
            print(f"error: {exc}")
            continue
        if parsed is None:
            continue
        name, args = parsed
        _print(await tools.dispatch(name, args))
