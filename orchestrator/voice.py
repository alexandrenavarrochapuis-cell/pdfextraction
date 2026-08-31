"""OpenAI Realtime API client. Full duplex speech to speech.

The realtime model holds the orchestration tools directly --- there is no second
LLM between the user's voice and :mod:`orchestrator.tools`.

The detail that decides whether this feels good or feels broken is barge-in:
when the user starts talking, playback stops that instant. See
:meth:`VoiceSession._barge_in`.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import threading
from typing import Any

from . import audio, config, tools

log = logging.getLogger("orchestrator.voice")


class Playback:
    """Output stream fed from a byte buffer that can be flushed instantly.

    A plain asyncio.Queue is not enough on its own: whatever has already been
    handed to the device keeps playing. Holding the pending audio in one buffer
    that the callback drains means :meth:`flush` truly cuts the voice off.
    """

    def __init__(self) -> None:
        self._buf = bytearray()
        self._lock = threading.Lock()
        self._stream = None
        self._frame = config.SAMPLE_WIDTH * config.CHANNELS

    def start(self) -> None:
        import sounddevice as sd

        self._stream = sd.RawOutputStream(
            samplerate=config.SAMPLE_RATE,
            channels=config.CHANNELS,
            dtype="int16",
            blocksize=config.BLOCK_FRAMES,
            device=audio.output_device(),
            callback=self._callback,
        )
        self._stream.start()

    def _callback(self, outdata, frames, time_info, status) -> None:  # noqa: ANN001
        wanted = frames * self._frame
        with self._lock:
            chunk = bytes(self._buf[:wanted])
            del self._buf[: len(chunk)]
        if len(chunk) < wanted:
            chunk += b"\x00" * (wanted - len(chunk))
        outdata[:wanted] = chunk

    def write(self, pcm: bytes) -> None:
        with self._lock:
            self._buf.extend(pcm)

    def flush(self) -> int:
        """Drop everything not yet played. Returns bytes discarded."""
        with self._lock:
            dropped = len(self._buf)
            self._buf.clear()
        return dropped

    def pending_ms(self) -> int:
        with self._lock:
            n = len(self._buf)
        return int(n / self._frame / config.SAMPLE_RATE * 1000)

    def stop(self) -> None:
        self.flush()
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            finally:
                self._stream = None


class Microphone:
    """24 kHz mono pcm16 capture in 40 ms blocks, pushed onto an asyncio queue."""

    def __init__(self, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue) -> None:
        self._loop = loop
        self._queue = queue
        self._stream = None
        self.open = not config.PUSH_TO_TALK  # gate for push to talk

    def start(self) -> None:
        import sounddevice as sd

        self._stream = sd.RawInputStream(
            samplerate=config.SAMPLE_RATE,
            channels=config.CHANNELS,
            dtype="int16",
            blocksize=config.BLOCK_FRAMES,
            device=audio.input_device(),
            callback=self._callback,
        )
        self._stream.start()

    def _callback(self, indata, frames, time_info, status) -> None:  # noqa: ANN001
        if not self.open:
            return
        data = bytes(indata)
        try:
            self._loop.call_soon_threadsafe(self._queue.put_nowait, data)
        except RuntimeError:
            pass  # loop closing

    def stop(self) -> None:
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            finally:
                self._stream = None


def bind_hotkey(on_change) -> Any:  # noqa: ANN001
    """Bind the push to talk hotkey. Toggle, not hold.

    Always-on mic in an office is wrong, and holding a chord for the length of
    a spoken paragraph is worse. Returns whatever handle the backend gives, or
    None if no backend is installed.
    """
    try:
        import keyboard  # type: ignore

        state = {"on": False}

        def _toggle() -> None:
            state["on"] = not state["on"]
            on_change(state["on"])

        keyboard.add_hotkey(config.PTT_HOTKEY, _toggle)
        log.info("push to talk: %s toggles the mic", config.PTT_HOTKEY)
        return keyboard
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "!! could not bind %s (%s); mic stays open. pip install keyboard",
            config.PTT_HOTKEY,
            exc,
        )
        on_change(True)
        return None


class VoiceSession:
    """One websocket session against the Realtime API."""

    def __init__(self) -> None:
        self.ws = None
        self.playback = Playback()
        self.mic: Microphone | None = None
        self._send_lock = asyncio.Lock()
        self._out_q: asyncio.Queue[bytes] = asyncio.Queue()
        # Notifier reads these to avoid interrupting a live turn.
        self.user_speaking = False
        self.response_active = False
        self.connected = asyncio.Event()

    # --- websocket plumbing --------------------------------------------------

    async def _connect(self):
        import websockets

        if not config.OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY is not set")
        headers = {
            "Authorization": f"Bearer {config.OPENAI_API_KEY}",
            "OpenAI-Beta": "realtime=v1",
        }
        log.info("connecting to %s", config.REALTIME_URL)
        try:  # websockets >= 14
            return await websockets.connect(
                config.REALTIME_URL, additional_headers=headers, max_size=None
            )
        except TypeError:  # websockets < 14
            return await websockets.connect(
                config.REALTIME_URL, extra_headers=headers, max_size=None
            )

    async def send(self, payload: dict[str, Any]) -> None:
        if self.ws is None:
            return
        async with self._send_lock:
            await self.ws.send(json.dumps(payload))

    async def _configure(self) -> None:
        await self.send(
            {
                "type": "session.update",
                "session": {
                    "modalities": ["audio", "text"],
                    "instructions": config.SYSTEM_INSTRUCTIONS,
                    "voice": config.REALTIME_VOICE,
                    "input_audio_format": "pcm16",
                    "output_audio_format": "pcm16",
                    "input_audio_transcription": {"model": "whisper-1"},
                    "turn_detection": {
                        "type": "server_vad",
                        "threshold": 0.5,
                        "prefix_padding_ms": 300,
                        "silence_duration_ms": 600,
                    },
                    "tools": tools.SCHEMAS,
                    "tool_choice": "auto",
                    "temperature": 0.7,
                },
            }
        )

    # --- barge-in ------------------------------------------------------------

    async def _barge_in(self) -> None:
        """The user started talking. Stop, immediately.

        Flush before anything else --- an await ahead of the flush is audible.
        """
        dropped = self.playback.flush()
        self.user_speaking = True
        if dropped:
            log.debug("barge-in: dropped %d bytes of queued audio", dropped)
        # Drain anything still sitting between the socket and the device.
        while not self._out_q.empty():
            try:
                self._out_q.get_nowait()
            except asyncio.QueueEmpty:
                break
        if self.response_active:
            await self.send({"type": "response.cancel"})

    # --- loops ---------------------------------------------------------------

    async def _mic_loop(self) -> None:
        queue: asyncio.Queue[bytes] = asyncio.Queue()
        loop = asyncio.get_running_loop()
        self.mic = Microphone(loop, queue)
        self.mic.start()

        def _set_open(on: bool) -> None:
            if self.mic is not None:
                self.mic.open = on
            log.info("mic %s", "open" if on else "muted")

        if config.PUSH_TO_TALK:
            await asyncio.to_thread(bind_hotkey, _set_open)

        while True:
            chunk = await queue.get()
            await self.send(
                {
                    "type": "input_audio_buffer.append",
                    "audio": base64.b64encode(chunk).decode("ascii"),
                }
            )

    async def _playback_loop(self) -> None:
        self.playback.start()
        while True:
            pcm = await self._out_q.get()
            self.playback.write(pcm)

    async def _recv_loop(self) -> None:
        assert self.ws is not None
        async for raw in self.ws:
            try:
                event = json.loads(raw)
            except json.JSONDecodeError:
                continue
            await self._handle(event)

    async def _handle(self, event: dict[str, Any]) -> None:
        etype = event.get("type", "")

        if etype == "input_audio_buffer.speech_started":
            await self._barge_in()
        elif etype == "input_audio_buffer.speech_stopped":
            self.user_speaking = False
        elif etype == "response.audio.delta":
            delta = event.get("delta")
            if delta:
                self._out_q.put_nowait(base64.b64decode(delta))
        elif etype == "response.created":
            self.response_active = True
        elif etype == "response.done":
            self.response_active = False
            self._log_response(event)
        elif etype == "response.function_call_arguments.done":
            await self._on_function_call(event)
        elif etype == "conversation.item.input_audio_transcription.completed":
            log.info("user: %s", (event.get("transcript") or "").strip())
        elif etype == "response.audio_transcript.done":
            log.info("assistant: %s", (event.get("transcript") or "").strip())
        elif etype == "session.created":
            self.connected.set()
            log.info("realtime session up")
        elif etype == "error":
            log.error("realtime error: %s", event.get("error"))

    def _log_response(self, event: dict[str, Any]) -> None:
        status = (event.get("response") or {}).get("status")
        if status not in (None, "completed", "cancelled"):
            log.warning("response ended %s: %s", status, (event.get("response") or {}).get("status_details"))

    async def _on_function_call(self, event: dict[str, Any]) -> None:
        name = event.get("name") or ""
        call_id = event.get("call_id")
        raw_args = event.get("arguments") or "{}"
        try:
            args = json.loads(raw_args)
        except json.JSONDecodeError:
            args = {}
        log.info("tool call %s %s", name, raw_args[:200])

        result = await tools.dispatch(name, args)

        await self.send(
            {
                "type": "conversation.item.create",
                "item": {
                    "type": "function_call_output",
                    "call_id": call_id,
                    "output": json.dumps(result, ensure_ascii=False, default=str),
                },
            }
        )
        await self.send({"type": "response.create"})

    # --- notifier hook -------------------------------------------------------

    async def announce(self, text: str) -> None:
        """Inject a system message and let the model speak it in its own words."""
        await self.send(
            {
                "type": "conversation.item.create",
                "item": {
                    "type": "message",
                    "role": "system",
                    "content": [{"type": "input_text", "text": text}],
                },
            }
        )
        await self.send({"type": "response.create"})

    def busy(self) -> bool:
        """True while a turn is in flight, in either direction."""
        return self.user_speaking or self.response_active or self.playback.pending_ms() > 120

    # --- entrypoint ----------------------------------------------------------

    async def run(self) -> None:
        problems = audio.check()
        if problems:
            log.warning("!! audio problems; run --list-devices and pin one via env")
        self.ws = await self._connect()
        try:
            await self._configure()
            await asyncio.gather(
                self._recv_loop(),
                self._mic_loop(),
                self._playback_loop(),
            )
        finally:
            if self.mic is not None:
                self.mic.stop()
            self.playback.stop()
            try:
                await self.ws.close()
            except Exception:  # noqa: BLE001
                pass
            self.ws = None
