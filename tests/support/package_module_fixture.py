"""Explicit module-only server selection; the original source server is default."""
from __future__ import annotations

import os
from pathlib import Path


def package_module_server_command(project: Path, port: int, original: list[str]) -> list[str]:
    mode = os.environ.get("EAGLER_PACKAGE_TEST_FIXTURE", "source")
    if mode not in ("source", "isolated"):
        raise ValueError("EAGLER_PACKAGE_TEST_FIXTURE must be source or isolated")
    if mode == "source":
        return original
    return ["node", str(project.resolve() / "tests/support/package-module-fixture.mjs"), str(port)]
