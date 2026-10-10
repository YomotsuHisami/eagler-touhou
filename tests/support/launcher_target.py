"""Select a built Launcher target without changing a browser test scenario.

Unset EAGLER_LAUNCHER_TEST_ROOT retains the original development server.
An explicit root uses the strict UI-only static fixture server, with no legacy
fallback or Service Worker generation. Supply real required assets separately.
"""
from __future__ import annotations

import os
from pathlib import Path


def launcher_test_root(project: Path) -> Path | None:
    target = os.environ.get("EAGLER_LAUNCHER_TEST_ROOT")
    if not target:
        return None
    root = Path(target)
    if not root.is_absolute():
        root = project / root
    root = root.resolve()
    if not (root / "index.html").is_file():
        raise FileNotFoundError(f"Launcher test target has no index.html: {root}")
    return root


def launcher_server_command(project: Path, port: int) -> list[str]:
    command = ["node", "scripts/serve.mjs", str(port)]
    root = launcher_test_root(project)
    return ["node", "tests/support/launcher-static-server.mjs", str(port), str(root)] if root is not None else command


def launcher_static_server_command(project: Path, port: int, original: list[str]) -> list[str]:
    """Retarget an existing HTTP fixture without changing its default command.

    The original fixture may run from the workspace instead of PROJECT, so the
    selected server entry and root are absolute. No legacy file fallback occurs.
    """
    root = launcher_test_root(project)
    if root is None:
        return original
    return ["node", str(project.resolve() / "tests/support/launcher-static-server.mjs"), str(port), str(root)]


def launcher_test_file(project: Path, name: str, *, legacy: str) -> Path:
    root = launcher_test_root(project)
    return root / name if root is not None else project / legacy


def runtime_frame_url(frame) -> str:
    """Observe the actual document only for an explicitly selected rewrite root.

    Original targets, including an explicit main comparison root, retain their
    src-attribute test interface. React Runtime
    replaces the child document to avoid adding iframe-only Back entries.
    """
    variant = os.environ.get("EAGLER_LAUNCHER_TEST_VARIANT", "rewrite")
    if variant not in ("main", "rewrite"):
        raise ValueError("Launcher test variant must be main or rewrite")
    if os.environ.get("EAGLER_LAUNCHER_TEST_ROOT") and variant == "rewrite":
        return frame.evaluate("frame => frame.contentWindow.location.href")
    return frame.get_attribute("src") or ""
