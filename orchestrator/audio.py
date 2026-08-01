"""Audio device plumbing, kept apart from the websocket protocol.

Windows specific: the right device is rarely the default one. Enumerate, let
the user pin one by index or by a substring of its name, and prefer WASAPI.
"""

from __future__ import annotations

import logging
from typing import Any

from . import config

log = logging.getLogger("orchestrator.audio")


def _sd():
    import sounddevice as sd  # imported lazily so --text needs no audio stack

    return sd


def devices() -> list[dict[str, Any]]:
    sd = _sd()
    hostapis = sd.query_hostapis()
    out = []
    for idx, dev in enumerate(sd.query_devices()):
        out.append(
            {
                "index": idx,
                "name": dev["name"],
                "hostapi": hostapis[dev["hostapi"]]["name"],
                "in": dev["max_input_channels"],
                "out": dev["max_output_channels"],
                "default_samplerate": dev["default_samplerate"],
            }
        )
    return out


def print_devices() -> None:
    sd = _sd()
    try:
        default_in, default_out = sd.default.device
    except Exception:  # noqa: BLE001
        default_in = default_out = None
    print(f"{'idx':>4}  {'in':>3} {'out':>3}  {'hostapi':<12} name")
    for d in devices():
        marks = "".join(
            [
                "<" if d["index"] == default_in else " ",
                ">" if d["index"] == default_out else " ",
            ]
        )
        print(
            f"{d['index']:>4}{marks} {d['in']:>3} {d['out']:>3}  "
            f"{d['hostapi']:<12} {d['name']}"
        )
    print("\npin one with INPUT_DEVICE / OUTPUT_DEVICE (index or name substring)")


def resolve(spec: str, kind: str) -> int | None:
    """Resolve an env spec to a device index.

    ``spec`` may be an index or a case-insensitive substring of the device
    name. WASAPI entries win ties on Windows: MME caps out at low sample rates
    and adds latency that barge-in cannot afford.
    """
    if not spec:
        return None
    spec = spec.strip()
    if spec.isdigit():
        return int(spec)

    want_input = kind == "input"
    candidates = [
        d
        for d in devices()
        if spec.lower() in d["name"].lower()
        and (d["in"] if want_input else d["out"]) > 0
    ]
    if not candidates:
        log.warning("!! no %s device matching %r; using system default", kind, spec)
        return None
    candidates.sort(key=lambda d: 0 if "WASAPI" in d["hostapi"].upper() else 1)
    chosen = candidates[0]
    log.info("%s device: [%d] %s (%s)", kind, chosen["index"], chosen["name"], chosen["hostapi"])
    return chosen["index"]


def input_device() -> int | None:
    return resolve(config.INPUT_DEVICE, "input")


def output_device() -> int | None:
    return resolve(config.OUTPUT_DEVICE, "output")


def check() -> list[str]:
    """Verify the pinned devices can actually run 24 kHz mono pcm16."""
    sd = _sd()
    problems: list[str] = []
    checks = (
        ("input", sd.check_input_settings, input_device()),
        ("output", sd.check_output_settings, output_device()),
    )
    for kind, check_settings, dev in checks:
        try:
            check_settings(
                device=dev,
                channels=config.CHANNELS,
                dtype="int16",
                samplerate=config.SAMPLE_RATE,
            )
        except Exception as exc:  # noqa: BLE001
            problems.append(f"{kind} device cannot do 24 kHz mono pcm16: {exc}")
    for line in problems:
        log.warning("!! %s", line)
    return problems
