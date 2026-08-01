"""SQLite task store.

This is the source of truth for what is running, not the voice model's context.
The model is told to call check_tasks before answering anything about status
precisely so that it reads from here.
"""

from __future__ import annotations

import difflib
import json
import sqlite3
import time
import uuid
from typing import Any, Iterable

from . import config

_conn: sqlite3.Connection | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id           TEXT PRIMARY KEY,
    label        TEXT NOT NULL,
    workspace    TEXT NOT NULL,
    cwd          TEXT NOT NULL,
    prompt       TEXT NOT NULL,
    status       TEXT NOT NULL,
    session_id   TEXT,
    branch       TEXT,
    worktree     TEXT,
    result       TEXT,
    error        TEXT,
    pid          INTEGER,
    created_at   REAL NOT NULL,
    started_at   REAL,
    finished_at  REAL,
    announced    INTEGER NOT NULL DEFAULT 0,
    turns        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
"""

ACTIVE_STATUSES = ("queued", "running")
TERMINAL_STATUSES = ("done", "failed", "cancelled")


def connect() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(str(config.DB_PATH), check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA synchronous=NORMAL")
        _conn.execute("PRAGMA busy_timeout=5000")
    return _conn


def init() -> None:
    conn = connect()
    conn.executescript(SCHEMA)
    conn.commit()


def close() -> None:
    global _conn
    if _conn is not None:
        _conn.close()
        _conn = None


def _row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


# --- writes ------------------------------------------------------------------


def create_task(
    label: str,
    workspace: str,
    cwd: str,
    prompt: str,
    branch: str | None = None,
    worktree: str | None = None,
) -> str:
    task_id = uuid.uuid4().hex[:12]
    conn = connect()
    conn.execute(
        "INSERT INTO tasks (id, label, workspace, cwd, prompt, status, branch,"
        " worktree, created_at) VALUES (?,?,?,?,?,'queued',?,?,?)",
        (task_id, label, workspace, cwd, prompt, branch, worktree, time.time()),
    )
    conn.commit()
    return task_id


def mark_running(task_id: str, pid: int | None = None) -> None:
    conn = connect()
    conn.execute(
        "UPDATE tasks SET status='running', started_at=COALESCE(started_at, ?),"
        " pid=?, announced=0 WHERE id=?",
        (time.time(), pid, task_id),
    )
    conn.commit()


def mark_done(task_id: str, result: str, session_id: str | None = None) -> None:
    conn = connect()
    conn.execute(
        "UPDATE tasks SET status='done', result=?, finished_at=?, pid=NULL,"
        " announced=0, turns=turns+1,"
        " session_id=COALESCE(?, session_id) WHERE id=?",
        (result, time.time(), session_id, task_id),
    )
    conn.commit()


def mark_failed(task_id: str, error: str, session_id: str | None = None) -> None:
    conn = connect()
    conn.execute(
        "UPDATE tasks SET status='failed', error=?, finished_at=?, pid=NULL,"
        " announced=0, turns=turns+1,"
        " session_id=COALESCE(?, session_id) WHERE id=?",
        (error, time.time(), session_id, task_id),
    )
    conn.commit()


def mark_cancelled(task_id: str, reason: str = "cancelled") -> None:
    conn = connect()
    conn.execute(
        "UPDATE tasks SET status='cancelled', error=?, finished_at=?, pid=NULL,"
        " announced=1 WHERE id=?",
        (reason, time.time(), task_id),
    )
    conn.commit()


def set_session_id(task_id: str, session_id: str) -> None:
    conn = connect()
    conn.execute("UPDATE tasks SET session_id=? WHERE id=?", (session_id, task_id))
    conn.commit()


def mark_announced(task_id: str) -> None:
    conn = connect()
    conn.execute("UPDATE tasks SET announced=1 WHERE id=?", (task_id,))
    conn.commit()


def reset_stale_running() -> int:
    """Anything left ``running`` from a previous process is orphaned.

    The subprocess died with the parent; the row lying about it would make the
    model narrate a task that is not there.
    """
    conn = connect()
    cur = conn.execute(
        "UPDATE tasks SET status='failed', error='orchestrator exited while task"
        " was running', finished_at=?, pid=NULL, announced=1"
        " WHERE status IN ('running','queued')",
        (time.time(),),
    )
    conn.commit()
    return cur.rowcount


def delete_task(task_id: str) -> None:
    conn = connect()
    conn.execute("DELETE FROM tasks WHERE id=?", (task_id,))
    conn.commit()


# --- reads -------------------------------------------------------------------


def get_task(task_id: str) -> dict[str, Any] | None:
    conn = connect()
    return _row_to_dict(
        conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    )


def list_tasks(
    statuses: Iterable[str] | None = None, limit: int = 50
) -> list[dict[str, Any]]:
    conn = connect()
    if statuses:
        statuses = list(statuses)
        marks = ",".join("?" * len(statuses))
        rows = conn.execute(
            f"SELECT * FROM tasks WHERE status IN ({marks})"
            " ORDER BY created_at DESC LIMIT ?",
            (*statuses, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def active_count() -> int:
    conn = connect()
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM tasks WHERE status IN ('queued','running')"
    ).fetchone()
    return int(row["n"])


def unannounced_finished() -> list[dict[str, Any]]:
    conn = connect()
    rows = conn.execute(
        "SELECT * FROM tasks WHERE announced=0 AND status IN ('done','failed')"
        " ORDER BY finished_at ASC"
    ).fetchall()
    return [dict(r) for r in rows]


def prunable(older_than_days: int | None = None) -> list[dict[str, Any]]:
    """Finished tasks whose worktrees are safe to remove.

    Never returns ``running`` or ``queued``. ``done`` only, per CLAUDE.md --- a
    failed task's worktree is the only place its half-finished work exists.
    """
    days = config.WORKTREE_TTL_DAYS if older_than_days is None else older_than_days
    cutoff = time.time() - days * 86400
    conn = connect()
    rows = conn.execute(
        "SELECT * FROM tasks WHERE status='done' AND worktree IS NOT NULL"
        " AND finished_at IS NOT NULL AND finished_at < ?"
        " ORDER BY finished_at ASC",
        (cutoff,),
    ).fetchall()
    return [dict(r) for r in rows]


def find_task(query: str) -> dict[str, Any] | None:
    """Fuzzy lookup for voice.

    Speech-to-text will not hand back the exact label. Try id, then exact
    label, then substring, then difflib, preferring recent and active tasks.
    """
    if not query:
        return None
    q = query.strip().lower()
    conn = connect()

    exact_id = conn.execute("SELECT * FROM tasks WHERE id=?", (query.strip(),)).fetchone()
    if exact_id is not None:
        return dict(exact_id)

    # Recent first so "the refactor" means the one he just started, not one
    # from last week with the same label.
    rows = [
        dict(r)
        for r in conn.execute(
            "SELECT * FROM tasks ORDER BY"
            " (status IN ('running','queued')) DESC, created_at DESC LIMIT 200"
        ).fetchall()
    ]
    if not rows:
        return None

    for row in rows:
        if row["label"].strip().lower() == q:
            return row
    for row in rows:
        label = row["label"].strip().lower()
        if q in label or label in q:
            return row

    labels = [r["label"].strip().lower() for r in rows]
    match = difflib.get_close_matches(q, labels, n=1, cutoff=0.6)
    if match:
        return rows[labels.index(match[0])]

    # Last resort: any single word of the query landing in a label.
    words = [w for w in q.split() if len(w) > 3]
    for row in rows:
        label = row["label"].strip().lower()
        if any(w in label for w in words):
            return row
    return None


# --- voice-shaped views ------------------------------------------------------


def _ago(ts: float | None) -> str:
    if not ts:
        return "unknown"
    delta = max(0, int(time.time() - ts))
    if delta < 60:
        return f"{delta}s"
    if delta < 3600:
        return f"{delta // 60}m"
    return f"{delta // 3600}h{(delta % 3600) // 60:02d}m"


def summarize(task: dict[str, Any]) -> dict[str, Any]:
    """Compact form for the model. No file contents, no long results."""
    out = {
        "id": task["id"],
        "label": task["label"],
        "workspace": task["workspace"],
        "status": task["status"],
        "age": _ago(task.get("created_at")),
    }
    if task["status"] == "running":
        out["running_for"] = _ago(task.get("started_at"))
    if task.get("finished_at"):
        out["finished"] = _ago(task["finished_at"]) + " ago"
    if task["status"] == "failed" and task.get("error"):
        out["error"] = (task["error"] or "")[:400]
    if task.get("branch"):
        out["branch"] = task["branch"]
    return out


def dumps(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, default=str)
