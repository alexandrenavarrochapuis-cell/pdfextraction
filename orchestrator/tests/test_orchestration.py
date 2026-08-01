"""State store, worker command construction, notifier queueing, cleanup scope.

These run without spawning a real worker or opening a socket.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
import time
import unittest
from pathlib import Path

from orchestrator import config, notifier, state, workers


class TempState(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        state.close()
        config.DB_PATH = Path(self._dir.name) / "tasks.db"
        state.init()

    def tearDown(self) -> None:
        state.close()
        self._dir.cleanup()


class StateTest(TempState):
    def _make(self, label: str, status: str = "queued") -> str:
        tid = state.create_task(label, "ws", "/cwd", "prompt")
        if status == "done":
            state.mark_done(tid, "finished fine", "sess-" + tid)
        elif status == "running":
            state.mark_running(tid, 123)
        elif status == "failed":
            state.mark_failed(tid, "boom")
        return tid

    def test_fuzzy_lookup_survives_speech_to_text(self) -> None:
        self._make("refactor the parser")
        self.assertIsNotNone(state.find_task("refactor the parser"))
        self.assertIsNotNone(state.find_task("Refactor The Parser"))
        self.assertIsNotNone(state.find_task("the parser"))
        self.assertIsNotNone(state.find_task("refactor the parcer"))
        self.assertIsNotNone(state.find_task("parser"))
        self.assertIsNone(state.find_task("completely unrelated words here"))

    def test_lookup_by_id_and_prefers_active(self) -> None:
        old = self._make("build docs", "done")
        self.assertEqual(state.find_task(old)["id"], old)
        time.sleep(0.01)
        new = self._make("build docs", "running")
        self.assertEqual(state.find_task("build docs")["id"], new)

    def test_unannounced_finished_then_marked(self) -> None:
        tid = self._make("a task", "done")
        self._make("still going", "running")
        pending = state.unannounced_finished()
        self.assertEqual([p["id"] for p in pending], [tid])
        state.mark_announced(tid)
        self.assertEqual(state.unannounced_finished(), [])

    def test_active_count_and_reset_stale(self) -> None:
        self._make("one", "running")
        self._make("two")
        self._make("three", "done")
        self.assertEqual(state.active_count(), 2)
        self.assertEqual(state.reset_stale_running(), 2)
        self.assertEqual(state.active_count(), 0)

    def test_prunable_never_returns_active_or_failed(self) -> None:
        conn = state.connect()
        for label, status in (
            ("old done", "done"),
            ("old failed", "failed"),
            ("old running", "running"),
        ):
            tid = self._make(label, status)
            conn.execute(
                "UPDATE tasks SET worktree='/wt/x', finished_at=? WHERE id=?",
                (time.time() - 30 * 86400, tid),
            )
        conn.commit()
        labels = [t["label"] for t in state.prunable(7)]
        self.assertEqual(labels, ["old done"])

    def test_prunable_respects_the_ttl(self) -> None:
        tid = self._make("recent", "done")
        conn = state.connect()
        conn.execute("UPDATE tasks SET worktree='/wt/x' WHERE id=?", (tid,))
        conn.commit()
        self.assertEqual(state.prunable(7), [])

    def test_summary_omits_bulk(self) -> None:
        tid = self._make("wordy", "done")
        conn = state.connect()
        conn.execute("UPDATE tasks SET result=? WHERE id=?", ("x" * 50_000, tid))
        conn.commit()
        summary = state.summarize(state.get_task(tid))
        self.assertNotIn("result", summary)
        self.assertLess(len(state.dumps(summary)), 500)


class CommandTest(unittest.TestCase):
    def test_never_carries_a_banned_flag(self) -> None:
        cmd = workers.build_command("do a thing")
        for banned in (
            "--bare",
            "--dangerously-skip-permissions",
            "--allow-dangerously-skip-permissions",
        ):
            self.assertNotIn(banned, cmd)
        workers._assert_safe(cmd)

    def test_assert_safe_rejects_banned_flags(self) -> None:
        for bad in (
            ["claude", "-p", "x", "--bare"],
            ["claude", "-p", "x", "--dangerously-skip-permissions"],
            ["claude", "-p", "x", "--permission-mode", "bypassPermissions"],
        ):
            with self.assertRaises(RuntimeError):
                workers._assert_safe(bad)

    def test_uses_the_allowlist_and_sonnet(self) -> None:
        cmd = workers.build_command("do a thing")
        self.assertIn("--allowedTools", cmd)
        self.assertEqual(cmd[cmd.index("--model") + 1], "sonnet")
        rules = cmd[cmd.index("--allowedTools") + 1].split(",")
        self.assertIn("Read", rules)
        # The space before * matters: `Bash(git diff *)` prefix-matches
        # `git diff`, `Bash(git diff*)` would also match `git diff-index`.
        self.assertIn("Bash(git diff *)", rules)
        self.assertNotIn("Bash(git diff*)", rules)

    def test_prompt_is_not_swallowed_by_the_variadic_flag(self) -> None:
        cmd = workers.build_command("my actual prompt")
        self.assertLess(cmd.index("my actual prompt"), cmd.index("--allowedTools"))

    def test_resume_appends_the_session_id(self) -> None:
        cmd = workers.build_command("more", resume_session="abc-123")
        self.assertEqual(cmd[cmd.index("--resume") + 1], "abc-123")

    def test_env_strips_the_api_key(self) -> None:
        os.environ["ANTHROPIC_API_KEY"] = "sk-should-not-survive"
        try:
            env = workers._env()
        finally:
            os.environ.pop("ANTHROPIC_API_KEY", None)
        self.assertNotIn("ANTHROPIC_API_KEY", env)
        self.assertNotIn("ANTHROPIC_AUTH_TOKEN", env)

    def test_concurrency_default_stays_at_two(self) -> None:
        self.assertLessEqual(config.MAX_CONCURRENT_WORKERS, 2)

    def test_result_parsing(self) -> None:
        self.assertEqual(
            workers.parse_result('{"session_id":"s","result":"r"}')["result"], "r"
        )
        self.assertEqual(
            workers.parse_result('warn\n{"a":1}\n{"session_id":"s2"}')["session_id"],
            "s2",
        )
        self.assertEqual(workers.parse_result(""), {})
        self.assertEqual(workers.parse_result("not json at all"), {})


class FakeSession:
    def __init__(self) -> None:
        self.connected = asyncio.Event()
        self.connected.set()
        self.announced: list[str] = []
        self._busy = False

    def busy(self) -> bool:
        return self._busy

    async def announce(self, text: str) -> None:
        self.announced.append(text)


class NotifierTest(TempState):
    async def _pump(self, session: FakeSession, ticks: int) -> None:
        task = asyncio.create_task(notifier.run(session, interval=0.01))
        await asyncio.sleep(0.01 * ticks + 0.05)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    def test_waits_for_the_turn_to_close(self) -> None:
        tid = state.create_task("some task", "ws", "/cwd", "p")
        state.mark_done(tid, "all good", "sess")
        session = FakeSession()
        session._busy = True

        async def scenario() -> None:
            task = asyncio.create_task(notifier.run(session, interval=0.01))
            await asyncio.sleep(0.08)
            self.assertEqual(session.announced, [], "spoke over the user")
            session._busy = False
            await asyncio.sleep(0.08)
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

        asyncio.run(scenario())
        self.assertEqual(len(session.announced), 1)
        self.assertIn("some task", session.announced[0])
        self.assertIn("succeeded", session.announced[0])

    def test_announces_each_task_once(self) -> None:
        for i in range(3):
            tid = state.create_task(f"task {i}", "ws", "/cwd", "p")
            state.mark_done(tid, "ok", "s")
        session = FakeSession()
        asyncio.run(self._pump(session, 12))
        self.assertEqual(len(session.announced), 3)
        self.assertEqual(len(set(session.announced)), 3)

    def test_failures_are_reported_plainly(self) -> None:
        tid = state.create_task("bad task", "ws", "/cwd", "p")
        state.mark_failed(tid, "exit code 1")
        session = FakeSession()
        asyncio.run(self._pump(session, 4))
        self.assertEqual(len(session.announced), 1)
        self.assertIn("failed", session.announced[0])
        self.assertIn("exit code 1", session.announced[0])

    def test_quiet_mode_says_nothing(self) -> None:
        tid = state.create_task("task", "ws", "/cwd", "p")
        state.mark_done(tid, "ok", "s")
        session = FakeSession()
        original = config.NOTIFY_MODE
        config.NOTIFY_MODE = "quiet"
        try:
            asyncio.run(self._pump(session, 4))
        finally:
            config.NOTIFY_MODE = original
        self.assertEqual(session.announced, [])


class TextModeParseTest(unittest.TestCase):
    def test_parses_the_debug_commands(self) -> None:
        from orchestrator import textmode

        name, args = textmode.parse("spawn fix the tests :: Make the suite pass.")
        self.assertEqual(name, "spawn_task")
        self.assertEqual(args["label"], "fix the tests")
        self.assertEqual(args["prompt"], "Make the suite pass.")

        self.assertEqual(textmode.parse("check")[1]["filter"], "active")
        self.assertEqual(textmode.parse("check all")[1]["filter"], "all")

        name, args = textmode.parse("followup fix the tests :: also lint")
        self.assertEqual((name, args["task"], args["prompt"]),
                         ("followup", "fix the tests", "also lint"))

        self.assertEqual(textmode.parse("result my task")[1]["task"], "my task")

        with self.assertRaises(ValueError):
            textmode.parse("spawn missing separator")
        with self.assertRaises(ValueError):
            textmode.parse("bogus command")


if __name__ == "__main__":
    unittest.main()
