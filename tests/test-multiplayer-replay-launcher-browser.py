from __future__ import annotations

import json
import socket
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

from support.launcher_target import launcher_server_command, runtime_frame_url


PROJECT = Path(__file__).resolve().parents[1]

_adapter_contracts = json.loads(subprocess.run(
    ["node", "scripts/inspect-adapter-contract.mjs"],
    cwd=PROJECT,
    check=True,
    capture_output=True,
    text=True,
).stdout)
MULTIPLAYER_FIXTURES = [
    {
        "game": report["game"],
        "product": f"{report['game']}mp",
        "midi": report["product"]["music"]["midiOptional"],
    }
    for report in _adapter_contracts
    if report["product"]["multiplayer"] is not None
]


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_http(url: str, timeout: float = 10.0) -> None:
    import urllib.request

    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=0.5) as response:
                if response.status < 400:
                    return
        except Exception:
            time.sleep(0.1)
    raise RuntimeError(f"HTTP server did not start: {url}")


def host_game(game: str, midi: bool) -> dict:
    digest = "a" * 64
    layout = "b" * 64
    return {
        "runtime": f"runtime/{game}/{game}.html?hosted=1&v=test-normal",
        "multiplayerRuntime": f"runtime/{game}/multiplayer/{game}.html?hosted=1&v=test-multiplayer",
        "gameData": {
            "path": f"{game}.data",
            "bytes": 1,
            "sha256": digest,
            "version": f"sha256-{digest}",
            "layout": f"sha256-{layout}",
        },
        "music": {"midi": {"files": []} if midi else {"files": [], "supported": False}},
    }


HOST_MANIFEST = {
    "schema": "eagler-touhou/host-manifest/1",
    "protocol": "eagler-touhou/1",
    "profile": "web-validation-replay-launcher",
    "shared": {
        "resourceMode": "hosted",
        "vanillaFont": "shared/msgothic.ttc?v=test",
        "unicodeFont": "shared/unifont.otf?v=test",
    },
    "games": {fixture["game"]: host_game(fixture["game"], fixture["midi"]) for fixture in MULTIPLAYER_FIXTURES},
}


RUNTIME_PROTOCOL_STUB = r"""<!doctype html>
<meta charset="utf-8">
<script>
(() => {
  const protocol = "eagler-touhou/1";
  const match = location.pathname.match(/\/runtime\/(th\d+)\/multiplayer\//);
  const game = match?.[1] || "";
  const epoch = Number(new URLSearchParams(location.search).get("runtimeEpoch"));
  window.__eaglerTestMessages = [];
  window.addEventListener("message", event => {
    const message = event.data || {};
    if (event.origin !== location.origin || message.protocol !== protocol || message.game !== game || message.epoch !== epoch) return;
    window.__eaglerTestMessages.push(message);
    event.source.postMessage({ protocol, game, epoch, request: message.request, ok: true }, event.origin);
  });
  window.parent.postMessage({ protocol, game, epoch, event: "ready" }, location.origin);
})();
</script>
"""


def main() -> int:
    http_port = free_port()
    launcher_url = f"http://127.0.0.1:{http_port}/"
    http = subprocess.Popen(
        launcher_server_command(PROJECT, http_port),
        cwd=PROJECT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    try:
        wait_http(launcher_url)
        page_errors: list[str] = []
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                for fixture in MULTIPLAYER_FIXTURES:
                    product = fixture["product"]
                    game = fixture["game"]
                    context = browser.new_context(
                        viewport={"width": 960, "height": 720},
                        service_workers="block",
                    )
                    page = context.new_page()
                    page.on("pageerror", lambda error: page_errors.append(str(error)))
                    page.route(
                        "**/host-manifest.json",
                        lambda route: route.fulfill(
                            status=200,
                            content_type="application/json",
                            body=json.dumps(HOST_MANIFEST),
                        ),
                    )
                    page.route(
                        "**/release-catalog.json",
                        lambda route: route.fulfill(status=404, body="not published in this test"),
                    )
                    runtime_path = f"runtime/{game}/multiplayer/{game}.html"
                    page.route(
                        f"**/{runtime_path}*",
                        lambda route: route.fulfill(
                            status=200,
                            content_type="text/html",
                            body=RUNTIME_PROTOCOL_STUB,
                        ),
                    )

                    page.goto(launcher_url, wait_until="load", timeout=30_000)
                    page.wait_for_function("window.__eaglerBoot?.done === true", timeout=30_000)
                    first_use_notice = page.locator("#firstUseNoticeDialog")
                    if first_use_notice.count() and first_use_notice.evaluate("dialog => dialog.open"):
                        page.locator("#firstUseNoticeClose").click()

                    page.locator(f'[data-product="{product}"]').click()
                    page.locator("#mpReplayViewer").click()
                    page.wait_for_function(
                        "document.querySelector('#gameFrame')?.contentWindow?.__eaglerTestMessages?.some(message => message.command === 'launch')",
                        timeout=30_000,
                    )

                    replay_src = runtime_frame_url(page.locator("#gameFrame"))
                    configure = page.locator("#gameFrame").evaluate(
                        "frame => frame.contentWindow.__eaglerTestMessages.find(message => message.command === 'configure')"
                    )
                    assert f"/{runtime_path}" in replay_src, replay_src
                    assert "runtimeVariant=multiplayer" in replay_src, replay_src
                    assert configure is not None
                    assert configure["options"]["replayViewer"] is True
                    assert not any(key.startswith("netplay") for key in configure["options"]), configure["options"]
                    context.close()
            finally:
                browser.close()

        assert not page_errors, page_errors
        print("Multiplayer Replay Launcher browser contract: PASS")
        return 0
    finally:
        http.terminate()
        try:
            http.wait(timeout=5)
        except subprocess.TimeoutExpired:
            http.kill()
            http.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
