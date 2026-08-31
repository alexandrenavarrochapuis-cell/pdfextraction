"""Env-driven configuration.

Defaults here are Max-subscription aware. Read the constraints in CLAUDE.md
before changing any of them; several of these values exist to keep the user
from locking himself out of his own interactive Claude sessions.
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

IS_WINDOWS = sys.platform == "win32"


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _env_int(name: str, default: int) -> int:
    raw = _env(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _parse_workspaces(raw: str) -> dict[str, Path]:
    """Parse ``name=path;name2=path2`` into a mapping.

    Semicolon-separated because Windows paths contain colons and commas are
    plausible inside a path. Entries without ``=`` are keyed by directory name.
    """
    out: dict[str, Path] = {}
    for chunk in raw.split(";"):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "=" in chunk:
            name, _, path = chunk.partition("=")
            name = name.strip()
            path = path.strip()
        else:
            path = chunk
            name = Path(path).name
        if not path:
            continue
        out[name] = Path(os.path.expandvars(os.path.expanduser(path))).resolve()
    return out


def _default_worktree_root() -> Path:
    """Short path, near the drive root.

    Git worktrees on Windows blow past MAX_PATH when nested under a deep
    project directory. Keep this shallow.
    """
    if IS_WINDOWS:
        drive = os.environ.get("SystemDrive", "C:")
        return Path(f"{drive}\\wt")
    return Path.home() / ".wt"


def _default_state_dir() -> Path:
    if IS_WINDOWS:
        base = os.environ.get("LOCALAPPDATA") or str(Path.home())
        return Path(base) / "voice-orchestrator"
    return Path.home() / ".local" / "share" / "voice-orchestrator"


def resolve_claude_bin() -> str:
    """Absolute path to the claude executable.

    On Windows the npm shim is ``claude.cmd``; ``create_subprocess_exec`` will
    not find it without the extension, and we never want to route through a
    shell. ``shutil.which`` consults PATHEXT so it returns the .cmd.
    """
    override = _env("CLAUDE_BIN")
    if override:
        return override
    found = shutil.which("claude")
    if found:
        return found
    if IS_WINDOWS:
        found = shutil.which("claude.cmd")
        if found:
            return found
    return "claude"


# --- workers -----------------------------------------------------------------

WORKSPACES: dict[str, Path] = _parse_workspaces(_env("WORKSPACES"))

# Max usage is shared across claude.ai, Desktop and Claude Code on rolling five
# hour windows plus weekly caps. Unbounded fan-out locks the user out of his own
# interactive sessions. Do not raise this.
MAX_CONCURRENT_WORKERS: int = _env_int("MAX_CONCURRENT_WORKERS", 2)

# Max has a separate weekly cap for Sonnet and one across all models. Routine
# worker turns go to Sonnet to protect the all-model budget.
WORKER_MODEL: str = _env("WORKER_MODEL", "sonnet")

CLAUDE_BIN: str = resolve_claude_bin()

WORKTREE_ROOT: Path = Path(
    os.path.expandvars(os.path.expanduser(_env("WORKTREE_ROOT")))
) if _env("WORKTREE_ROOT") else _default_worktree_root()

# Kill a worker that has run away rather than let it eat the usage window.
WORKER_TIMEOUT_SECONDS: int = _env_int("WORKER_TIMEOUT_SECONDS", 3600)

# Worktrees for tasks finished longer ago than this are prunable.
WORKTREE_TTL_DAYS: int = _env_int("WORKTREE_TTL_DAYS", 7)

# The permission allowlist. Never `--dangerously-skip-permissions`; if a task
# needs something that is not here, add a narrow rule.
#
# Syntax note: the space before `*` matters. `Bash(git diff *)` prefix-matches
# `git diff`. `Bash(git diff*)` would also match `git diff-index`.
ALLOWED_TOOLS: list[str] = [
    "Read",
    "Glob",
    "Grep",
    "Edit",
    "Write",
    "NotebookEdit",
    "TodoWrite",
    "WebFetch",
    "WebSearch",
    "Task",
    "Bash(git status)",
    "Bash(git status *)",
    "Bash(git diff)",
    "Bash(git diff *)",
    "Bash(git log *)",
    "Bash(git show *)",
    "Bash(git add *)",
    "Bash(git commit *)",
    "Bash(git branch *)",
    "Bash(git checkout *)",
    "Bash(git switch *)",
    "Bash(git stash *)",
    "Bash(git restore *)",
    "Bash(git rev-parse *)",
    "Bash(ls *)",
    "Bash(cat *)",
    "Bash(pwd)",
    "Bash(python -m pytest *)",
    "Bash(python -m *)",
    "Bash(pytest *)",
    "Bash(npm test *)",
    "Bash(npm run *)",
    "Bash(npx tsc *)",
    "Bash(ruff *)",
    "Bash(black *)",
    "Bash(mypy *)",
]

_extra_tools = _env("EXTRA_ALLOWED_TOOLS")
if _extra_tools:
    ALLOWED_TOOLS = ALLOWED_TOOLS + [
        t.strip() for t in _extra_tools.split(";") if t.strip()
    ]


# --- state -------------------------------------------------------------------

STATE_DIR: Path = Path(_env("STATE_DIR")) if _env("STATE_DIR") else _default_state_dir()
DB_PATH: Path = Path(_env("DB_PATH")) if _env("DB_PATH") else STATE_DIR / "tasks.db"


# --- voice -------------------------------------------------------------------

OPENAI_API_KEY: str = _env("OPENAI_API_KEY")
REALTIME_MODEL: str = _env("REALTIME_MODEL", "gpt-4o-realtime-preview")
REALTIME_URL: str = _env(
    "REALTIME_URL", "wss://api.openai.com/v1/realtime?model={model}"
).format(model=_env("REALTIME_MODEL", "gpt-4o-realtime-preview"))
REALTIME_VOICE: str = _env("REALTIME_VOICE", "alloy")

SAMPLE_RATE: int = 24_000
CHANNELS: int = 1
BLOCK_MS: int = 40
BLOCK_FRAMES: int = SAMPLE_RATE * BLOCK_MS // 1000  # 960 frames @ 24 kHz
SAMPLE_WIDTH: int = 2  # pcm16

# Pin a WASAPI device by index or by substring of its name. Empty means default.
INPUT_DEVICE: str = _env("INPUT_DEVICE")
OUTPUT_DEVICE: str = _env("OUTPUT_DEVICE")

# Always-on mic in an office is wrong.
PUSH_TO_TALK: bool = _env("PUSH_TO_TALK", "1") not in ("0", "false", "no")
PTT_HOTKEY: str = _env("PTT_HOTKEY", "ctrl+shift+space")

# "on_complete" announces finished tasks. "quiet" does nothing.
NOTIFY_MODE: str = _env("NOTIFY_MODE", "on_complete")
NOTIFY_INTERVAL_SECONDS: float = float(_env("NOTIFY_INTERVAL_SECONDS", "3") or 3)

SYSTEM_INSTRUCTIONS: str = (
    "You direct background coding agents on the user's machine. Speak in short "
    "spoken sentences, never in lists or code. When the user describes work, "
    "call spawn_task with a complete self-contained prompt, then confirm in one "
    "sentence and stop talking. Never read file contents or long results aloud "
    "unless asked. When a task finishes, say the label and one sentence of "
    "outcome. If a task fails, say so plainly and offer the error, do not "
    "narrate a recovery plan unless asked. Never invent task status. Always "
    "call check_tasks before answering a question about what is running."
)


def workspace_path(name: str | None) -> Path:
    """Resolve a workspace name to a path.

    Falls back to the sole configured workspace when the caller did not name
    one, then to the current directory. Voice input mangles names, so match
    case-insensitively and on prefix before giving up.
    """
    if not name:
        if len(WORKSPACES) == 1:
            return next(iter(WORKSPACES.values()))
        raise KeyError(
            "no workspace given and %d configured" % len(WORKSPACES)
        )
    if name in WORKSPACES:
        return WORKSPACES[name]
    lowered = name.strip().lower()
    for key, path in WORKSPACES.items():
        if key.lower() == lowered:
            return path
    for key, path in WORKSPACES.items():
        if key.lower().startswith(lowered) or lowered.startswith(key.lower()):
            return path
    raise KeyError(f"unknown workspace {name!r}; known: {sorted(WORKSPACES)}")
