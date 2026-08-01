"""Headless `claude -p` workers, one per task, each in its own git worktree.

Hard rules enforced here, see CLAUDE.md:

* never ``--bare`` --- it skips OAuth and keychain reads and expects
  ANTHROPIC_API_KEY, which on a Max subscription means either an auth failure
  or silent API-rate billing.
* never ``ANTHROPIC_API_KEY`` in the child environment --- :func:`_env` strips
  it.
* never ``--dangerously-skip-permissions`` --- the allowlist in config does
  this job.
* follow-ups run with the same ``cwd`` as the original spawn, because session
  id lookup is scoped to the project directory and its worktrees.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from . import config, state

log = logging.getLogger("orchestrator.workers")

_semaphore: asyncio.Semaphore | None = None
_running: dict[str, asyncio.subprocess.Process] = {}
_tasks: set[asyncio.Task] = set()

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def semaphore() -> asyncio.Semaphore:
    """Lazily built so it binds to the running loop."""
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(config.MAX_CONCURRENT_WORKERS)
    return _semaphore


def _env() -> dict[str, str]:
    """Child environment with the API key stripped.

    The user is on Claude Max. If ANTHROPIC_API_KEY leaks into the worker, the
    CLI bills at API rates instead of using the subscription. Keep this.
    """
    env = dict(os.environ)
    env.pop("ANTHROPIC_API_KEY", None)
    env.pop("ANTHROPIC_AUTH_TOKEN", None)
    env.pop("ANTHROPIC_API_KEY_FILE", None)
    # If the orchestrator is itself launched from a Claude Code session, the
    # worker would inherit that session id and report it back as its own --- and
    # every follow-up would then resume the wrong conversation.
    for var in (
        "CLAUDE_CODE_SESSION_ID",
        "CLAUDE_SESSION_ID",
        "CLAUDE_CODE_REMOTE_SESSION_ID",
        "CLAUDE_CODE_CHILD_SESSION",
    ):
        env.pop(var, None)
    # Keeps the child from trying to render progress into a pipe.
    env["CI"] = env.get("CI", "1")
    return env


def slug(text: str, limit: int = 32) -> str:
    s = _SLUG_RE.sub("-", text.strip().lower()).strip("-")
    return (s[:limit].strip("-")) or "task"


# --- git worktrees -----------------------------------------------------------


def _git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        check=check,
    )


def is_git_repo(path: Path) -> bool:
    if not path.is_dir():
        return False
    try:
        out = _git(path, "rev-parse", "--is-inside-work-tree", check=False)
    except (OSError, FileNotFoundError):
        return False
    return out.returncode == 0 and out.stdout.strip() == "true"


def create_worktree(repo: Path, label: str, task_id: str) -> tuple[Path, str]:
    """Add a worktree off the repo's current HEAD.

    Path stays short --- ``WORKTREE_ROOT/<slug>-<id>`` --- because git worktrees
    on Windows fail once the path runs long.
    """
    branch = f"task/{slug(label)}-{task_id[:6]}"
    config.WORKTREE_ROOT.mkdir(parents=True, exist_ok=True)
    path = config.WORKTREE_ROOT / f"{slug(label, 20)}-{task_id[:6]}"
    _git(repo, "worktree", "add", "-b", branch, str(path), "HEAD")
    return path, branch


def remove_worktree(repo: Path, worktree: Path, branch: str | None) -> list[str]:
    """Best effort teardown. Returns human-readable notes about what happened."""
    notes: list[str] = []
    res = _git(repo, "worktree", "remove", str(worktree), "--force", check=False)
    if res.returncode == 0:
        notes.append(f"removed worktree {worktree}")
    else:
        notes.append(f"worktree remove failed: {res.stderr.strip()}")
        _git(repo, "worktree", "prune", check=False)
    if branch:
        res = _git(repo, "branch", "-D", branch, check=False)
        if res.returncode == 0:
            notes.append(f"deleted branch {branch}")
        else:
            notes.append(f"branch delete failed: {res.stderr.strip()}")
    return notes


# --- command construction ----------------------------------------------------


def build_command(prompt: str, resume_session: str | None = None) -> list[str]:
    """Assemble the worker command line.

    The prompt goes in as the positional argument immediately after ``-p`` and
    the allowlist is passed comma-joined as a single value. Both matter:
    ``--allowedTools`` is variadic, so a space-separated list placed before the
    prompt would swallow the prompt as another tool rule.
    """
    if any("," in rule for rule in config.ALLOWED_TOOLS):
        raise RuntimeError("allowlist rules must not contain commas")
    cmd = [
        config.CLAUDE_BIN,
        "-p",
        prompt,
        "--output-format",
        "json",
        # Max has a separate weekly Sonnet cap and one across all models;
        # routine worker turns go to Sonnet to protect the all-model budget.
        "--model",
        config.WORKER_MODEL,
        # Allowlist, never --dangerously-skip-permissions.
        "--allowedTools",
        ",".join(config.ALLOWED_TOOLS),
    ]
    if resume_session:
        cmd += ["--resume", resume_session]
    return cmd


def _assert_safe(cmd: list[str]) -> None:
    """Guardrail against a future edit reintroducing a banned flag."""
    banned = {
        "--bare",
        "--dangerously-skip-permissions",
        "--allow-dangerously-skip-permissions",
    }
    hit = banned.intersection(cmd)
    if hit:
        raise RuntimeError(f"refusing to launch worker with banned flags: {sorted(hit)}")
    for flag in ("--permission-mode",):
        if flag in cmd:
            idx = cmd.index(flag)
            if idx + 1 < len(cmd) and cmd[idx + 1] == "bypassPermissions":
                raise RuntimeError("refusing to launch worker with bypassPermissions")


# --- process control ---------------------------------------------------------


async def _start(cmd: list[str], cwd: Path) -> asyncio.subprocess.Process:
    _assert_safe(cmd)
    kwargs: dict[str, Any] = {
        "cwd": str(cwd),
        "env": _env(),
        "stdin": asyncio.subprocess.DEVNULL,
        "stdout": asyncio.subprocess.PIPE,
        "stderr": asyncio.subprocess.PIPE,
    }
    if config.IS_WINDOWS:
        # New process group so the tree can be signalled as a unit.
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    # shell=False, with CLAUDE_BIN already resolved to the full path (claude.cmd
    # on Windows) by config.resolve_claude_bin().
    return await asyncio.create_subprocess_exec(*cmd, **kwargs)


def _kill_tree(proc: asyncio.subprocess.Process) -> None:
    """Terminate a worker and everything it spawned.

    ``claude`` is a node process behind a shim; killing only the shim leaves
    orphans, which is exactly what verification step 4 checks for.
    """
    if proc.returncode is not None:
        return
    try:
        if config.IS_WINDOWS:
            subprocess.run(
                ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                capture_output=True,
                check=False,
            )
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.terminate()
        except ProcessLookupError:
            pass


async def shutdown(grace: float = 5.0) -> None:
    """Cancel every running worker with SIGTERM, then reap."""
    procs = list(_running.items())
    for task_id, proc in procs:
        log.warning("terminating worker for task %s (pid %s)", task_id, proc.pid)
        _kill_tree(proc)
    for task_id, proc in procs:
        try:
            await asyncio.wait_for(proc.wait(), timeout=grace)
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
        state.mark_cancelled(task_id, "orchestrator shut down")
    _running.clear()
    for t in list(_tasks):
        t.cancel()
    if _tasks:
        await asyncio.gather(*_tasks, return_exceptions=True)
    _tasks.clear()
    # Anything still queued never got a worker; do not leave the row claiming
    # otherwise for the next run to trip over.
    for task in state.list_tasks(["queued"]):
        state.mark_cancelled(task["id"], "orchestrator shut down before start")


# --- result parsing ----------------------------------------------------------


def parse_result(stdout: str) -> dict[str, Any]:
    """Pull the JSON result object out of `claude -p --output-format json`.

    Tolerates leading noise on stdout by scanning for the last well-formed
    top-level object.
    """
    stdout = (stdout or "").strip()
    if not stdout:
        return {}
    try:
        obj = json.loads(stdout)
        if isinstance(obj, dict):
            return obj
        if isinstance(obj, list) and obj and isinstance(obj[-1], dict):
            return obj[-1]
    except json.JSONDecodeError:
        pass
    decoder = json.JSONDecoder()
    last: dict[str, Any] = {}
    idx = 0
    while idx < len(stdout):
        start = stdout.find("{", idx)
        if start < 0:
            break
        try:
            obj, end = decoder.raw_decode(stdout, start)
        except json.JSONDecodeError:
            idx = start + 1
            continue
        if isinstance(obj, dict):
            last = obj
        idx = end
    return last


# --- the two entry points ----------------------------------------------------


async def _run(task_id: str, prompt: str, cwd: Path, resume_session: str | None) -> None:
    """Run one worker turn to completion and write the outcome to state."""
    async with semaphore():
        task = state.get_task(task_id)
        if task is None or task["status"] == "cancelled":
            return
        cmd = build_command(prompt, resume_session)
        started = time.monotonic()
        try:
            proc = await _start(cmd, cwd)
        except FileNotFoundError:
            state.mark_failed(
                task_id,
                f"could not launch {config.CLAUDE_BIN!r}; set CLAUDE_BIN or fix PATH",
            )
            return
        except OSError as exc:
            state.mark_failed(task_id, f"launch failed: {exc}")
            return

        _running[task_id] = proc
        state.mark_running(task_id, proc.pid)
        log.info("task %s running (pid %s) in %s", task_id, proc.pid, cwd)

        try:
            out, err = await asyncio.wait_for(
                proc.communicate(), timeout=config.WORKER_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            _kill_tree(proc)
            await asyncio.gather(proc.wait(), return_exceptions=True)
            state.mark_failed(
                task_id,
                f"timed out after {config.WORKER_TIMEOUT_SECONDS}s",
            )
            return
        except asyncio.CancelledError:
            _kill_tree(proc)
            await asyncio.gather(proc.wait(), return_exceptions=True)
            state.mark_cancelled(task_id, "cancelled")
            raise
        finally:
            _running.pop(task_id, None)

        stdout = (out or b"").decode("utf-8", "replace")
        stderr = (err or b"").decode("utf-8", "replace")
        payload = parse_result(stdout)
        session_id = payload.get("session_id") or payload.get("sessionId")
        elapsed = time.monotonic() - started

        is_error = bool(payload.get("is_error")) or proc.returncode not in (0, None)
        text = payload.get("result") or payload.get("error") or stderr or stdout

        if is_error:
            state.mark_failed(task_id, (text or "worker exited non-zero").strip()[:4000], session_id)
            log.warning("task %s failed in %.1fs", task_id, elapsed)
        else:
            state.mark_done(task_id, (text or "").strip(), session_id)
            log.info("task %s done in %.1fs", task_id, elapsed)


def _schedule(coro) -> asyncio.Task:
    t = asyncio.create_task(coro)
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)
    return t


async def spawn(prompt: str, workspace: str | None = None, label: str | None = None) -> dict[str, Any]:
    """Create a task, isolate it in a worktree, and start it in the background.

    Returns immediately --- the voice model must not block on a coding agent.
    """
    repo = config.workspace_path(workspace)
    if not is_git_repo(repo):
        raise ValueError(f"{repo} is not a git repository")
    ws_name = workspace or next(
        (k for k, v in config.WORKSPACES.items() if v == repo), repo.name
    )
    label = (label or " ".join(prompt.split()[:6]))[:80]

    task_id = state.create_task(label, ws_name, str(repo), prompt)
    try:
        worktree, branch = create_worktree(repo, label, task_id)
    except subprocess.CalledProcessError as exc:
        state.mark_failed(task_id, f"worktree creation failed: {exc.stderr or exc}")
        raise ValueError(f"could not create worktree in {repo}: {exc.stderr or exc}") from exc

    conn = state.connect()
    # cwd is the worktree from here on. Follow-ups must reuse it verbatim:
    # session id lookup is scoped to the project directory and its worktrees.
    conn.execute(
        "UPDATE tasks SET cwd=?, worktree=?, branch=? WHERE id=?",
        (str(worktree), str(worktree), branch, task_id),
    )
    conn.commit()

    _schedule(_run(task_id, prompt, worktree, None))
    queued_behind = max(0, state.active_count() - config.MAX_CONCURRENT_WORKERS)
    return {
        "task_id": task_id,
        "label": label,
        "workspace": ws_name,
        "branch": branch,
        "queued_behind": queued_behind,
    }


async def followup(task_id: str, prompt: str) -> dict[str, Any]:
    """Resume an existing task's session with another turn.

    Runs with the recorded ``cwd``, not the workspace root, and with
    ``--resume <session_id>`` so it continues rather than starting fresh.
    """
    task = state.get_task(task_id)
    if task is None:
        raise KeyError(task_id)
    if task["status"] in ("queued", "running"):
        raise ValueError("task is still running")
    session_id = task["session_id"]
    cwd = Path(task["cwd"])
    if not cwd.is_dir():
        raise ValueError(f"working directory {cwd} is gone; cannot resume")

    conn = state.connect()
    conn.execute(
        "UPDATE tasks SET status='queued', result=NULL, error=NULL,"
        " finished_at=NULL, announced=0, prompt=? WHERE id=?",
        (prompt, task_id),
    )
    conn.commit()

    _schedule(_run(task_id, prompt, cwd, session_id))
    return {
        "task_id": task_id,
        "label": task["label"],
        "resumed_session": session_id,
        "cwd": str(cwd),
    }
