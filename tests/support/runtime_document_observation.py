"""Opt-in actual-document observations, independent of frontend/artifact root."""
from __future__ import annotations

import os
from pathlib import Path


def runtime_document_observation_script(env=None) -> str | None:
    values = os.environ if env is None else env
    mode = values.get("EAGLER_RUNTIME_TEST_OBSERVATION", "attribute")
    if mode not in ("attribute", "document"):
        raise ValueError("EAGLER_RUNTIME_TEST_OBSERVATION must be attribute or document")
    return Path(__file__).with_name("runtime-document-observation.js").read_text(encoding="utf-8") if mode == "document" else None


def install_runtime_document_observation(page) -> None:
    source = runtime_document_observation_script()
    if source is not None:
        page.add_init_script(source)
