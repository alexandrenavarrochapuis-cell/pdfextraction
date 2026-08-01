"""Prune finished worktrees.

    python -m orchestrator.cleanup [--days 7] [--dry-run] [--yes]

Only touches tasks in ``done`` state older than the TTL. Never ``running`` or
``queued`` --- and not ``failed`` either, since a failed task's worktree is the
only place its half-finished work exists.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from . import config, state, workers

log = logging.getLogger("orchestrator.cleanup")


def run(days: int, dry_run: bool, assume_yes: bool) -> int:
    state.init()
    candidates = state.prunable(days)
    if not candidates:
        print(f"nothing to prune (no done tasks older than {days} days)")
        return 0

    print(f"{len(candidates)} worktree(s) eligible, done more than {days} days ago:\n")
    for task in candidates:
        print(f"  {task['label']:<32} {task['branch'] or '-':<34} {task['worktree']}")

    if dry_run:
        print("\ndry run, nothing removed")
        return 0

    if not assume_yes and sys.stdin.isatty():
        if input("\nremove these? [y/N] ").strip().lower() not in ("y", "yes"):
            print("aborted")
            return 1

    removed = 0
    for task in candidates:
        worktree = Path(task["worktree"])
        try:
            repo = config.workspace_path(task["workspace"])
        except KeyError:
            # Workspace was reconfigured away; fall back to the recorded repo.
            repo = worktree.parent
            log.warning(
                "workspace %r no longer configured; pruning %s best effort",
                task["workspace"],
                worktree,
            )
        if not workers.is_git_repo(repo):
            log.warning("skipping %s: %s is not a git repo", task["label"], repo)
            continue
        for note in workers.remove_worktree(repo, worktree, task["branch"]):
            print(f"  {task['label']}: {note}")
        conn = state.connect()
        conn.execute(
            "UPDATE tasks SET worktree=NULL WHERE id=?", (task["id"],)
        )
        conn.commit()
        removed += 1

    print(f"\npruned {removed} of {len(candidates)}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="orchestrator.cleanup")
    parser.add_argument(
        "--days",
        type=int,
        default=config.WORKTREE_TTL_DAYS,
        help=f"prune done tasks finished more than this many days ago (default {config.WORKTREE_TTL_DAYS})",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("-y", "--yes", action="store_true", help="do not prompt")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(message)s")
    try:
        return run(args.days, args.dry_run, args.yes)
    finally:
        state.close()


if __name__ == "__main__":
    raise SystemExit(main())
