"""Entrypoint.

    python -m orchestrator.main            voice + notifier
    python -m orchestrator.main --text     same tool loop over stdin
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import signal
import sys

from . import config, state, workers

log = logging.getLogger("orchestrator")


def setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )


def validate_workspaces() -> list[str]:
    """Check every configured workspace exists and is a git repo. Warn loudly."""
    problems: list[str] = []
    if not config.WORKSPACES:
        problems.append(
            "no workspaces configured; set WORKSPACES=name=C:\\path\\to\\repo"
            " (semicolon-separated for more than one)"
        )
    for name, path in config.WORKSPACES.items():
        if not path.exists():
            problems.append(f"workspace {name!r}: {path} does not exist")
        elif not path.is_dir():
            problems.append(f"workspace {name!r}: {path} is not a directory")
        elif not workers.is_git_repo(path):
            problems.append(f"workspace {name!r}: {path} is not a git repository")
    for line in problems:
        log.warning("!! %s", line)
    if problems:
        log.warning(
            "!! %d workspace problem(s); spawn_task will fail for those",
            len(problems),
        )
    return problems


def preflight() -> None:
    log.info("claude binary: %s", config.CLAUDE_BIN)
    log.info("worker model: %s", config.WORKER_MODEL)
    log.info("max concurrent workers: %d", config.MAX_CONCURRENT_WORKERS)
    log.info("worktree root: %s", config.WORKTREE_ROOT)
    log.info("state db: %s", config.DB_PATH)
    orphaned = state.reset_stale_running()
    if orphaned:
        log.warning(
            "!! %d task(s) were left running by a previous process; marked failed",
            orphaned,
        )
    validate_workspaces()


async def _run_text() -> None:
    from . import textmode

    await textmode.run()


async def _run_voice() -> None:
    try:
        from . import notifier, voice
    except ImportError as exc:
        log.error(
            "audio dependencies missing (%s). pip install -r"
            " orchestrator/requirements.txt, or use --text",
            exc,
        )
        return

    if not config.OPENAI_API_KEY:
        log.error("OPENAI_API_KEY is not set; voice mode cannot start. Use --text.")
        return

    session = voice.VoiceSession()
    await asyncio.gather(
        session.run(),
        notifier.run(session),
    )


async def _amain(text: bool) -> int:
    preflight()
    loop = asyncio.get_running_loop()
    stop = asyncio.Event()

    def _request_stop() -> None:
        if not stop.is_set():
            log.warning("shutting down; terminating workers")
            stop.set()

    # add_signal_handler is POSIX-only; on Windows KeyboardInterrupt is what
    # actually arrives, and it is handled by the caller.
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _request_stop)
        except (NotImplementedError, AttributeError, ValueError):
            pass

    main_task = asyncio.create_task(_run_text() if text else _run_voice())
    stop_task = asyncio.create_task(stop.wait())
    try:
        done, _ = await asyncio.wait(
            {main_task, stop_task}, return_when=asyncio.FIRST_COMPLETED
        )
        if main_task in done:
            main_task.result()
    except KeyboardInterrupt:
        pass
    finally:
        for t in (main_task, stop_task):
            if not t.done():
                t.cancel()
        await asyncio.gather(main_task, stop_task, return_exceptions=True)
        await workers.shutdown()
        state.close()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="orchestrator")
    parser.add_argument(
        "--text",
        action="store_true",
        help="run the tool loop over stdin instead of audio",
    )
    parser.add_argument(
        "--list-devices",
        action="store_true",
        help="enumerate audio devices and exit",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    setup_logging(args.verbose)

    if args.list_devices:
        from . import audio

        try:
            audio.print_devices()
        except ImportError as exc:
            log.error(
                "sounddevice is not installed (%s); pip install -r"
                " orchestrator/requirements.txt",
                exc,
            )
            return 1
        return 0

    state.init()

    try:
        return asyncio.run(_amain(args.text))
    except KeyboardInterrupt:
        # Ctrl+C outside the loop's handler (the normal path on Windows).
        try:
            asyncio.run(workers.shutdown())
        except Exception:  # noqa: BLE001
            pass
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
