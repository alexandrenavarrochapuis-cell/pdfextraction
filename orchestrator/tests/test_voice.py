"""Barge-in and playback tests.

Barge-in is the single detail that decides whether the thing feels good or
feels broken, so it gets tested without a microphone in the loop: the buffer,
the flush, and the event handler that drives them.
"""

from __future__ import annotations

import asyncio
import base64
import unittest

from orchestrator import config, state, voice


class PlaybackBufferTest(unittest.TestCase):
    def setUp(self) -> None:
        self.pb = voice.Playback()

    def test_flush_discards_everything_pending(self) -> None:
        self.pb.write(b"\x01\x02" * 4800)  # 9600 bytes = 200 ms at 24 kHz
        self.assertEqual(self.pb.pending_ms(), 200)
        dropped = self.pb.flush()
        self.assertEqual(dropped, 9600)
        self.assertEqual(self.pb.pending_ms(), 0)

    def test_callback_drains_and_pads_with_silence(self) -> None:
        self.pb.write(b"\xff" * 100)
        out = bytearray(200)
        self.pb._callback(memoryview(out), 100, None, None)
        self.assertEqual(bytes(out[:100]), b"\xff" * 100)
        self.assertEqual(bytes(out[100:]), b"\x00" * 100)
        self.assertEqual(self.pb.pending_ms(), 0)


class FakeWS:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send(self, raw: str) -> None:
        import json

        self.sent.append(json.loads(raw))


class BargeInTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.session = voice.VoiceSession()
        self.ws = FakeWS()
        self.session.ws = self.ws

    async def test_speech_started_flushes_queued_audio(self) -> None:
        pcm = base64.b64encode(b"\x10\x20" * 2400).decode()
        await self.session._handle({"type": "response.created"})
        await self.session._handle({"type": "response.audio.delta", "delta": pcm})
        await self.session._handle({"type": "response.audio.delta", "delta": pcm})
        self.session.playback.write(b"\x00" * 9600)
        self.assertEqual(self.session._out_q.qsize(), 2)
        self.assertEqual(self.session.playback.pending_ms(), 200)

        await self.session._handle({"type": "input_audio_buffer.speech_started"})

        self.assertEqual(self.session.playback.pending_ms(), 0, "playback not cut")
        self.assertEqual(self.session._out_q.qsize(), 0, "queue not drained")
        self.assertTrue(self.session.user_speaking)
        self.assertIn("response.cancel", [m["type"] for m in self.ws.sent])

    async def test_flush_happens_before_any_await(self) -> None:
        """No network round trip may sit between speech_started and silence."""
        self.session.playback.write(b"\x00" * 48000)
        blocked = asyncio.Event()

        async def slow_send(raw: str) -> None:
            await blocked.wait()

        self.session.ws.send = slow_send  # type: ignore[assignment]
        self.session.response_active = True

        task = asyncio.create_task(
            self.session._handle({"type": "input_audio_buffer.speech_started"})
        )
        await asyncio.sleep(0)  # let it reach the blocked send
        self.assertEqual(
            self.session.playback.pending_ms(), 0,
            "audio still queued while response.cancel is in flight",
        )
        blocked.set()
        await task

    async def test_no_cancel_when_nothing_is_speaking(self) -> None:
        await self.session._handle({"type": "input_audio_buffer.speech_started"})
        self.assertNotIn("response.cancel", [m["type"] for m in self.ws.sent])

    async def test_speech_stopped_clears_the_flag(self) -> None:
        await self.session._handle({"type": "input_audio_buffer.speech_started"})
        await self.session._handle({"type": "input_audio_buffer.speech_stopped"})
        self.assertFalse(self.session.user_speaking)


class ToolCallTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        import tempfile
        from pathlib import Path

        self._dir = tempfile.TemporaryDirectory()
        state.close()
        config.DB_PATH = Path(self._dir.name) / "tasks.db"
        state.init()

    def tearDown(self) -> None:
        state.close()
        self._dir.cleanup()

    async def test_function_call_replies_then_requests_a_response(self) -> None:
        session = voice.VoiceSession()
        session.ws = FakeWS()
        await session._handle(
            {
                "type": "response.function_call_arguments.done",
                "name": "check_tasks",
                "call_id": "call_1",
                "arguments": '{"filter": "active"}',
            }
        )
        types = [m["type"] for m in session.ws.sent]
        self.assertEqual(types, ["conversation.item.create", "response.create"])
        item = session.ws.sent[0]["item"]
        self.assertEqual(item["type"], "function_call_output")
        self.assertEqual(item["call_id"], "call_1")
        self.assertIn("tasks", item["output"])

    async def test_unknown_tool_still_gets_an_answer(self) -> None:
        session = voice.VoiceSession()
        session.ws = FakeWS()
        await session._handle(
            {
                "type": "response.function_call_arguments.done",
                "name": "nope",
                "call_id": "c",
                "arguments": "not json",
            }
        )
        self.assertIn("error", session.ws.sent[0]["item"]["output"])


class BusyTest(unittest.IsolatedAsyncioTestCase):
    async def test_busy_tracks_both_directions(self) -> None:
        session = voice.VoiceSession()
        self.assertFalse(session.busy())
        session.user_speaking = True
        self.assertTrue(session.busy())
        session.user_speaking = False
        session.response_active = True
        self.assertTrue(session.busy())
        session.response_active = False
        session.playback.write(b"\x00" * (config.SAMPLE_RATE // 2))
        self.assertTrue(session.busy())


if __name__ == "__main__":
    unittest.main()
