from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

from support.launcher_target import launcher_server_command
from support.runtime_document_observation import install_runtime_document_observation


PROJECT = Path(__file__).resolve().parents[1]
RELAY = PROJECT / "server" / "netplay-relay.mjs"
DEFAULT_FIXTURES = (
    {"product": "th06mp", "game": "th06", "label": "TH06 MP", "midi": True},
    {"product": "th07mp", "game": "th07", "label": "TH07 MP", "midi": True},
)
TH08_FIXTURE = {"product": "th08mp", "game": "th08", "label": "TH08 MP", "midi": True}


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_http(url: str, timeout: float = 30.0) -> None:
    import urllib.request

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with opener.open(url, timeout=0.5) as response:
                if response.status < 400:
                    return
        except Exception:
            time.sleep(0.1)
    raise RuntimeError(f"HTTP server did not start: {url}")


def wait_relay(process: subprocess.Popen[str], host: str, port: int, timeout: float = 10.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"relay exited early: {process.returncode}")
        try:
            with socket.create_connection((host, port), timeout=0.25):
                return
        except OSError:
            time.sleep(0.05)
    raise RuntimeError("relay did not start")


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


def host_manifest(relay_url: str) -> dict:
    return {
        "schema": "eagler-touhou/host-manifest/1",
        "protocol": "eagler-touhou/1",
        "profile": "web-validation-mp-runtime-exit",
        "shared": {
            "resourceMode": "hosted",
            "vanillaFont": "shared/msgothic.ttc?v=test",
            "unicodeFont": "shared/unifont.otf?v=test",
            "netplayRelay": relay_url,
        },
        "games": {fixture["game"]: host_game(fixture["game"], fixture["midi"]) for fixture in DEFAULT_FIXTURES},
    }


RUNTIME_PROTOCOL_STUB = r"""<!doctype html>
<meta charset="utf-8">
<script>
(() => {
  const protocol = "eagler-touhou/1";
  const game = location.pathname.match(/\/runtime\/(th\d+)\/multiplayer\//)?.[1] || "";
  const epoch = Number(new URLSearchParams(location.search).get("runtimeEpoch"));
  window.addEventListener("message", event => {
    const message = event.data || {};
    if (event.origin !== location.origin || message.protocol !== protocol ||
        message.game !== game || message.epoch !== epoch) return;
    if (message.command === "configure") window.__eaglerConfigureOptions = message.options;
    event.source.postMessage(
      { protocol, game, epoch, request: message.request, ok: true },
      event.origin
    );
    if (message.command === "launch") {
      window.parent.postMessage(
        { protocol, game, epoch: epoch - 1, event: "exit", status: "error" },
        location.origin
      );
      window.__eaglerStaleExitSent = true;
    }
  });
  window.__eaglerSendCurrentExit = () => window.parent.postMessage(
    { protocol, game, epoch, event: "exit", status: "error" },
    location.origin
  );
  window.parent.postMessage({ protocol, game, epoch, event: "ready" }, location.origin);
})();
</script>
"""


def close_first_use_notice(page) -> None:
    dialog = page.locator("#firstUseNoticeDialog")
    if dialog.count() and dialog.evaluate("element => element.open"):
        page.locator("#firstUseNoticeClose").click()


def run_case(browser, base_url: str, relay_url: str, fixture: dict, host_payload: dict) -> None:
    product = fixture["product"]
    game = fixture["game"]
    context = browser.new_context(viewport={"width": 960, "height": 720}, service_workers="block")
    page = context.new_page()
    install_runtime_document_observation(page)
    page.route(
        "**/host-manifest.json*",
        lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps(host_payload)),
    )
    page.route("**/release-catalog.json*", lambda route: route.fulfill(status=404, body="not published in this test"))
    runtime_path = f"runtime/{game}/multiplayer/{game}.html"
    page.route(
        f"**/{runtime_path}*",
        lambda route: route.fulfill(status=200, content_type="text/html", body=RUNTIME_PROTOCOL_STUB),
    )

    page.goto(base_url, wait_until="load", timeout=30000)
    page.wait_for_function("window.__eaglerBoot?.done === true", timeout=30000)
    page.wait_for_timeout(500)
    close_first_use_notice(page)

    card = page.locator(f'[data-product="{product}"]')
    card.click()
    # The library rail previews a different cover on first activation.
    if not page.locator("#mpCreateRoom").is_visible():
        card.click()
    if not page.locator("#mpCreateRoom").is_visible():
        raise AssertionError(f"{product} selection did not open multiplayer entry")
    page.locator("#mpCreateRoom").click()
    page.wait_for_selector("#mpRoomView:not([hidden])", timeout=10000)
    page.wait_for_function("document.querySelector('#mpLocalPlayer')?.hidden === false", timeout=10000)
    room_code = page.locator("#mpRoomCode").inner_text()
    assert room_code

    # Launch the room's local preflight through the real Launcher so the
    # Runtime session/epoch owner is active. The stub answers configure/launch,
    # then emits the same exit event as a Runtime that terminates before its
    # first frame.
    page.locator("[data-mp-seat='0'] .mp-seat-edit").click()
    page.wait_for_selector("#mpRoomPanel[open]", timeout=5000)
    assert page.locator("#mpCheckGame").is_enabled()
    page.locator("#mpCheckGame").click()
    page.wait_for_function(
        "globalThis.__originalRuntimeDocumentObservation ? globalThis.__originalRuntimeDocumentObservation.hasRuntimeEpoch(document.querySelector('#gameFrame')) : document.querySelector('#gameFrame')?.src.includes('runtimeEpoch=')",
        timeout=60000 if game == "th08" else 10000,
    )
    page.wait_for_function(
        "document.querySelector('#gameFrame')?.contentWindow?.__eaglerStaleExitSent === true",
        timeout=10000,
    )
    assert page.locator("#gameFrame").evaluate(
        "frame => frame.contentWindow.__eaglerConfigureOptions?.multiplayerPreflight === true"
    ) == (game == "th08"), "Only TH08 requires an explicit preflight role"
    assert page.locator("#gameFrame").evaluate(
        "frame => !frame.contentWindow.__eaglerConfigureOptions?.netplayMode"
    ), "Room game check must not join gameplay transport"
    page.wait_for_timeout(50)
    assert page.locator("#player").evaluate("el => el.classList.contains('open')"), (
        "stale Runtime exit from the previous navigation epoch must be ignored"
    )
    page.locator("#gameFrame").evaluate("frame => frame.contentWindow.__eaglerSendCurrentExit()")
    page.wait_for_function(
        "document.querySelector('#player')?.classList.contains('open') === false",
        timeout=10000,
    )

    assert page.locator("#mpRoomView").is_visible()
    assert page.locator("#mpRoomCode").inner_text() == room_code
    assert page.locator("#mpLocalPlayer").evaluate("element => !element.hidden")
    assert page.locator("#gameId").inner_text() == fixture["label"]
    assert page.locator("#main").evaluate("el => el.classList.contains('has-selection')")
    assert f"game={product}" in page.url
    assert f"mpRoom={room_code}" in page.url
    assert page.evaluate(
        """({ product, roomCode }) => {
          const saved = JSON.parse(sessionStorage.getItem(`eagler-touhou-${product}-room-v1`) || 'null');
          return saved?.room?.code === roomCode;
        }""",
        {"product": product, "roomCode": room_code},
    )

    if page.locator("#mpRoomPanel[open]").count():
        page.locator("#mpRoomPanelClose").click()
    page.locator("#mpLeaveRoom").click()
    page.wait_for_selector("#mpRoomView", state="hidden", timeout=5000)
    assert f"mpRoom={room_code}" not in page.url
    context.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--game", choices=tuple(fixture["game"] for fixture in DEFAULT_FIXTURES) + ("th08",))
    parser.add_argument("--th08-data", type=Path, default=Path(os.environ["TH08_MP_DATA"]) if os.environ.get("TH08_MP_DATA") else None)
    args = parser.parse_args()
    fixtures = (TH08_FIXTURE,) if args.game == "th08" else tuple(
        fixture for fixture in DEFAULT_FIXTURES if not args.game or fixture["game"] == args.game)
    if args.game == "th08" and (not args.th08_data or not args.th08_data.is_file()):
        parser.error("--game th08 requires --th08-data or TH08_MP_DATA pointing to retail th08.dat")
    http_port = free_port()
    relay_port = free_port()
    while relay_port == http_port:
        relay_port = free_port()
    launcher_url = f"http://127.0.0.1:{http_port}/"
    relay_url = f"ws://127.0.0.1:{relay_port}/"
    http_env = os.environ.copy()
    if args.game == "th08":
        http_env.update({"EAGLER_DEVELOPMENT_GAMES": "th08", "EAGLER_TH08_DATA_FILE": str(args.th08_data.resolve())})
    http = subprocess.Popen(
        launcher_server_command(PROJECT, http_port),
        cwd=PROJECT,
        env=http_env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    relay_env = os.environ.copy()
    relay_env.update({
        "EAGLER_NETPLAY_RELAY_HOST": "127.0.0.1",
        "EAGLER_NETPLAY_RELAY_PORT": str(relay_port),
        "EAGLER_NETPLAY_STUN_URLS": "",
    })
    relay = subprocess.Popen(
        ["node", str(RELAY)],
        cwd=PROJECT,
        env=relay_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    try:
        wait_http(launcher_url)
        wait_relay(relay, "127.0.0.1", relay_port)
        host_payload = host_manifest(relay_url)
        if args.game == "th08":
            import urllib.request
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(launcher_url + "host-manifest.json", timeout=5) as response:
                host_payload = json.load(response)
            host_payload["shared"]["netplayRelay"] = relay_url
            host_payload["games"]["th08"]["multiplayerRuntime"] = "runtime/th08/multiplayer/th08.html?hosted=1&v=test-multiplayer"
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                for fixture in fixtures:
                    run_case(browser, launcher_url, relay_url, fixture, host_payload)
            finally:
                browser.close()
        print("MP Runtime exit -> room: PASS")
        return 0
    finally:
        http.terminate()
        relay.terminate()
        try:
            http.wait(timeout=5)
        except subprocess.TimeoutExpired:
            http.kill()
            http.wait(timeout=5)
        try:
            relay.wait(timeout=5)
        except subprocess.TimeoutExpired:
            relay.kill()
            relay.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
