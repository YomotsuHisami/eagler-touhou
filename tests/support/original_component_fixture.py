"""Select an actual React component fixture; original main is the default.

This changes a module-only browser harness's entry, not its actions or expected
behavior. No browser starts while building the explicit fixture.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess


def original_component_fixture(project: Path, name: str) -> dict | None:
    target = os.environ.get("EAGLER_COMPONENT_TEST_TARGET", "main")
    if target not in ("main", "react"):
        raise ValueError("EAGLER_COMPONENT_TEST_TARGET must be main or react")
    if target == "main":
        return None
    result = subprocess.run(
        ["node", str(project / "tests/support/original-component-fixture.mjs"), name],
        cwd=project, check=True, capture_output=True, text=True,
    )
    return json.loads(result.stdout)
