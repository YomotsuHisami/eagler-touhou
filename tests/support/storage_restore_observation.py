"""Separate opt-in failure-child observation; never replaces the original injector."""
from __future__ import annotations

import json
import os
from pathlib import Path


def restore_failure_capture_enabled(env=None) -> bool:
    values = os.environ if env is None else env
    mode = values.get("EAGLER_STORAGE_RESTORE_OBSERVATION", "current")
    if mode not in ("current", "capture"):
        raise ValueError("EAGLER_STORAGE_RESTORE_OBSERVATION must be current or capture")
    return mode == "capture"


def install_restore_failure_capture(context, game: str, runtime_name: str) -> None:
    if restore_failure_capture_enabled():
        source = Path(__file__).with_name("storage-restore-observation.js").read_text(encoding="utf-8")
        context.add_init_script(f"({source})({json.dumps({'game': game, 'runtimeName': runtime_name})})")
