"""End to end over a real websocket, against a stub Realtime server.

Covers what the FakeWS unit tests cannot: the connect handshake, the shape of
``session.update``, and a full tool call round trip across the wire. No audio
hardware involved --- the mic and playback loops are not started.
"""

from __future__ import annotations

import asyncio
import base64
import json
import tempfile
import unittest
from pathlib import Path

try:
    import websockets
    from websockets.asyncio.server import serve
except ImportError:  # pragma: no cover - exercised only without the dep
    websockets = None
    serve = None

from orchestrator import config, state, voice


@unittest.skipIf(websockets is None, "websockets not installed")
class RealtimeProtocolTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        state.close()
        config.DB_PATH = Path(self._dir.name) / "tasks.db"
        state.init()

        self.received: list[dict] = []
        self.script: list[dict] = []
        self.done = asyncio.Event()

        async def handler(ws) -> None:  # noqa: ANN001
            await ws.send(json.dumps({"type": "session.created"}))
            for event in self.script:
                await ws.send(json.dumps(event))
            async for raw in ws:
                self.received.append(json.loads(raw))
                if self.received[-1]["type"] == "response.create":
                    self.done.set()

        self.server = await serve(handler, "127.0.0.1", 0)
        port = self.server.sockets[0].getsockname()[1]
        self._orig_url = config.REALTIME_URL
        self._orig_key = config.OPENAI_API_KEY
        config.REALTIME_URL = f"ws://127.0.0.1:{port}"
        config.OPENAI_API_KEY = "test-key"

    async def asyncTearDown(self) -> None:
        self.server.close()
        await self.server.wait_closed()
        config.REALTIME_URL = self._orig_url
        config.OPENAI_API_KEY = self._orig_key
        state.close()
        self._dir.cleanup()

    async def _drive(self, timeout: float = 5.0) -> voice.VoiceSession:
        session = voice.VoiceSession()
        session.ws = await session._connect()
        await session._configure()
        recv = asyncio.create_task(session._recv_loop())
        try:
            await asyncio.wait_for(self.done.wait(), timeout=timeout)
        finally:
            recv.cancel()
            await asyncio.gather(recv, return_exceptions=True)
            await session.ws.close()
        return session

    async def test_session_update_carries_the_tools_and_audio_format(self) -> None:
        self.script = [
            {
                "type": "response.function_call_arguments.done",
                "name": "check_tasks",
                "call_id": "call_abc",
                "arguments": "{}",
            }
        ]
        await self._drive()

        update = self.received[0]
        self.assertEqual(update["type"], "session.update")
        sess = update["session"]
        self.assertEqual(sess["input_audio_format"], "pcm16")
        self.assertEqual(sess["output_audio_format"], "pcm16")
        self.assertEqual(sess["turn_detection"]["type"], "server_vad")
        self.assertIn("direct background coding agents", sess["instructions"])
        self.assertEqual(
            sorted(t["name"] for t in sess["tools"]),
            ["check_tasks", "followup", "read_result", "spawn_task"],
        )

    async def test_tool_call_round_trip_over_the_wire(self) -> None:
        self.script = [
            {
                "type": "response.function_call_arguments.done",
                "name": "check_tasks",
                "call_id": "call_abc",
                "arguments": '{"filter": "active"}',
            }
        ]
        await self._drive()

        reply = self.received[1]
        self.assertEqual(reply["type"], "conversation.item.create")
        self.assertEqual(reply["item"]["call_id"], "call_abc")
        payload = json.loads(reply["item"]["output"])
        self.assertEqual(payload["tasks"], [])
        self.assertEqual(payload["max_concurrent"], config.MAX_CONCURRENT_WORKERS)
        self.assertEqual(self.received[2]["type"], "response.create")

    async def test_barge_in_cancels_a_live_response_over_the_wire(self) -> None:
        pcm = base64.b64encode(b"\x01\x02" * 12000).decode()
        self.script = [
            {"type": "response.created"},
            {"type": "response.audio.delta", "delta": pcm},
            {"type": "input_audio_buffer.speech_started"},
        ]

        session = voice.VoiceSession()
        session.ws = await session._connect()
        await session._configure()
        recv = asyncio.create_task(session._recv_loop())
        try:
            for _ in range(100):
                if any(m["type"] == "response.cancel" for m in self.received):
                    break
                await asyncio.sleep(0.02)
        finally:
            recv.cancel()
            await asyncio.gather(recv, return_exceptions=True)
            await session.ws.close()

        self.assertIn("response.cancel", [m["type"] for m in self.received])
        self.assertEqual(session._out_q.qsize(), 0)
        self.assertEqual(session.playback.pending_ms(), 0)
        self.assertTrue(session.user_speaking)

    async def test_notifier_announcement_reaches_the_server(self) -> None:
        from orchestrator import notifier

        tid = state.create_task("nightly build", "ws", "/cwd", "p")
        state.mark_done(tid, "green across the board", "sess")

        session = voice.VoiceSession()
        session.ws = await session._connect()
        await session._configure()
        recv = asyncio.create_task(session._recv_loop())
        notify = asyncio.create_task(notifier.run(session, interval=0.01))
        try:
            await asyncio.wait_for(self.done.wait(), timeout=5.0)
        finally:
            for t in (recv, notify):
                t.cancel()
            await asyncio.gather(recv, notify, return_exceptions=True)
            await session.ws.close()

        item = self.received[1]["item"]
        self.assertEqual(item["role"], "system")
        self.assertIn("nightly build", item["content"][0]["text"])
        self.assertEqual(state.unannounced_finished(), [])


if __name__ == "__main__":
    unittest.main()
