from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright


PROJECT = Path(__file__).resolve().parents[1]
WORKSPACE = PROJECT.parent
RELAY = PROJECT / "server" / "netplay-relay.mjs"


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


def wait_relay(process: subprocess.Popen[str], timeout: float = 10.0) -> None:
    assert process.stdout is not None
    deadline = time.time() + timeout
    while time.time() < deadline:
        line = process.stdout.readline()
        if line:
            if "netplay relay listening" in line:
                return
        elif process.poll() is not None:
            raise RuntimeError(f"relay exited early: {process.returncode}")
        else:
            time.sleep(0.05)
    raise RuntimeError("relay did not start")


def host_manifest(relay_url: str) -> dict:
    digest = "a" * 64
    layout = "b" * 64
    game = "th07"
    return {
        "schema": "eagler-touhou/host-manifest/1",
        "protocol": "eagler-touhou/1",
        "profile": "web-validation-spectator-launcher",
        "shared": {
            "resourceMode": "hosted",
            "vanillaFont": "shared/msgothic.ttc?v=test",
            "unicodeFont": "shared/unifont.otf?v=test",
            "netplayRelay": relay_url,
        },
        "games": {
            game: {
                "runtime": f"runtime/{game}/{game}.html?hosted=1&v=test-normal",
                "multiplayerRuntime": f"runtime/{game}/multiplayer/{game}.html?hosted=1&v=test-multiplayer",
                "gameData": {
                    "path": f"{game}.data",
                    "bytes": 1,
                    "sha256": digest,
                    "version": f"sha256-{digest}",
                    "layout": f"sha256-{layout}",
                },
                "music": {"midi": {"files": []}},
            }
        },
    }


RUNTIME_PROTOCOL_STUB = r"""<!doctype html>
<meta charset="utf-8">
<script>
(() => {
  const protocol = "eagler-touhou/1";
  const game = "th07";
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


LOBBY_RECORDING_INIT = r"""
(() => {
  const NativeWebSocket = globalThis.WebSocket;
  globalThis.__eaglerTestLobbyMessages = [];
  globalThis.WebSocket = class RecordingWebSocket extends NativeWebSocket {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", event => {
        try {
          const message = JSON.parse(String(event.data));
          if (message && typeof message.type === "string") globalThis.__eaglerTestLobbyMessages.push(message);
        } catch {}
      });
    }
  };
})();
"""


def main() -> int:
    http_port = free_port()
    relay_port = free_port()
    while relay_port == http_port:
        relay_port = free_port()
    launcher_url = f"http://127.0.0.1:{http_port}/"
    relay_url = f"ws://127.0.0.1:{relay_port}/"
    room_code = "4321"
    transport_room = f"th07mp-{room_code}"

    http = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(http_port), "--bind", "127.0.0.1"],
        cwd=WORKSPACE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    relay_env = os.environ.copy()
    relay_env.update({
        "TH07_RELAY_HOST": "127.0.0.1",
        "TH07_RELAY_PORT": str(relay_port),
        "TH07_STUN_URLS": "",
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
        wait_relay(relay)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                setup_context = browser.new_context()
                setup = setup_context.new_page()
                setup.evaluate(
                    """async ({ relay, room }) => {
                      const connect = (id, key) => new Promise((resolve, reject) => {
                        const socket = new WebSocket(`${relay}?room=${encodeURIComponent(room)}&lobby=${encodeURIComponent(id)}&member=m_${encodeURIComponent(id)}`);
                        const client = { socket, messages: [] };
                        socket.addEventListener('message', event => {
                          try { client.messages.push(JSON.parse(String(event.data))); } catch {}
                        });
                        socket.addEventListener('open', () => resolve(client), { once: true });
                        socket.addEventListener('error', () => reject(new Error(`${key} lobby socket failed`)), { once: true });
                      });
                      const owner = await connect('owner_client_0001', 'owner');
                      const player = await connect('player_client_0002', 'player');
                      globalThis.__spectatorSetup = { owner, player };
                    }""",
                    {"relay": relay_url, "room": transport_room},
                )
                setup.wait_for_function(
                    "__spectatorSetup.owner.messages.some(m => m.type === 'state') && __spectatorSetup.player.messages.some(m => m.type === 'state')",
                    timeout=10_000,
                )
                setup.evaluate(
                    "__spectatorSetup.owner.socket.send(JSON.stringify({ type: 'take-seat', seat: 0, loadout: 0, ready: true, name: 'Owner' }))"
                )
                setup.wait_for_function(
                    "__spectatorSetup.owner.messages.some(m => m.type === 'state' && m.room?.seats?.[0]?.clientId === 'owner_client_0001')",
                    timeout=10_000,
                )
                setup.evaluate(
                    "__spectatorSetup.player.socket.send(JSON.stringify({ type: 'take-seat', seat: 1, loadout: 1, ready: true, name: 'Player' }))"
                )
                setup.wait_for_function(
                    "__spectatorSetup.owner.messages.some(m => m.type === 'state' && m.room?.seats?.[0]?.ready && m.room?.seats?.[1]?.ready)",
                    timeout=10_000,
                )

                launcher_context = browser.new_context(
                    viewport={"width": 960, "height": 720},
                    service_workers="block",
                )
                launcher_context.add_init_script(LOBBY_RECORDING_INIT)
                page = launcher_context.new_page()
                page_errors: list[str] = []
                page.on("pageerror", lambda error: page_errors.append(str(error)))
                manifest_body = json.dumps(host_manifest(relay_url))
                page.route(
                    "**/host-manifest.json",
                    lambda route: route.fulfill(status=200, content_type="application/json", body=manifest_body),
                )
                page.route(
                    "**/release-catalog.json",
                    lambda route: route.fulfill(status=404, body="not published in this test"),
                )
                page.route(
                    "**/runtime/th07/multiplayer/th07.html*",
                    lambda route: route.fulfill(status=200, content_type="text/html", body=RUNTIME_PROTOCOL_STUB),
                )

                page.goto(launcher_url, wait_until="load", timeout=30_000)
                page.wait_for_function("window.__eaglerBoot?.done === true", timeout=30_000)
                first_use_notice = page.locator("#firstUseNoticeDialog")
                if first_use_notice.count() and first_use_notice.evaluate("dialog => dialog.open"):
                    page.locator("#firstUseNoticeClose").click()
                toast = page.locator("#toast")
                assert "联机服务未配置" not in toast.inner_text(), (
                    "configured Relay must not emit an unconfigured-service toast during render"
                )
                page.locator('[data-product="th07mp"]').click()
                page.locator("#mpJoinCode").fill(room_code)
                page.locator("#mpJoinRoom").click()
                page.wait_for_selector("#mpRoomView:not([hidden])", timeout=10_000)
                page.wait_for_function(
                    "__eaglerTestLobbyMessages.some(m => m.type === 'state' && m.room?.seats?.[0]?.clientId === 'owner_client_0001' && m.room?.seats?.[1]?.clientId === 'player_client_0002')",
                    timeout=10_000,
                )

                assert page.locator("#mpLocalPlayer").is_hidden()
                assert page.locator("#mpSpectatorJoin").is_enabled()
                assert page.locator('[data-mp-seat="0"]').get_attribute("title").startswith("Owner - ")
                assert page.locator('[data-mp-seat="1"]').get_attribute("title").startswith("Player - ")
                assert page.locator("#mpSpectatorList .mp-spectator-empty").count() == 1

                setup.evaluate("__spectatorSetup.owner.socket.send(JSON.stringify({ type: 'start' }))")
                setup.wait_for_function(
                    "__spectatorSetup.owner.messages.some(m => m.type === 'start' && m.serial === 1)",
                    timeout=10_000,
                )
                page.wait_for_function(
                    "__eaglerTestLobbyMessages.some(m => m.type === 'start' && m.serial === 1)",
                    timeout=10_000,
                )
                assert not page.locator("#player").evaluate("el => el.classList.contains('open')")

                page.locator("#mpDisplayName").fill("Watcher")
                page.locator("#mpDisplayName").blur()
                page.locator("#mpSpectatorJoin").click()
                page.wait_for_function(
                    "__eaglerTestLobbyMessages.some(m => m.type === 'spectator-start' && m.serial === 1)",
                    timeout=10_000,
                )
                page.wait_for_function(
                    "document.querySelector('#gameFrame')?.contentWindow?.__eaglerTestMessages?.some(message => message.command === 'launch')",
                    timeout=30_000,
                )

                mine = page.locator("#mpSpectatorList .mp-spectator-entry.mine")
                assert mine.count() == 1
                assert mine.get_attribute("title") == "Watcher"
                assert mine.locator(".mp-spectator-avatar").inner_text() == "W"

                configure = page.locator("#gameFrame").evaluate(
                    "frame => frame.contentWindow.__eaglerTestMessages.find(message => message.command === 'configure')"
                )
                options = configure["options"]
                spectator_id = options["netplaySpectatorId"]
                assert options["netplaySpectator"] is True
                assert options["netplaySpectatorCount"] >= 1
                assert options["netplayPlayerCount"] == 2
                assert isinstance(spectator_id, str) and len(spectator_id) >= 8
                gameplay = urlparse(options["netplayUrl"])
                query = parse_qs(gameplay.query)
                assert query.get("room") == [transport_room]
                assert query.get("run") == ["1"]
                assert query.get("spectator") == [spectator_id]
                assert query.get("member") == [page.evaluate("localStorage.getItem('eagler-touhou-mp-member-v1')")]
                assert "player" not in query
                assert not page_errors, page_errors

                launcher_context.close()
                setup_context.close()
            finally:
                browser.close()

        print("Multiplayer spectator Launcher browser contract: PASS explicit-spectator=1 late-start=1 names=1 runtime-options=1")
        return 0
    finally:
        relay.terminate()
        http.terminate()
        for process in (relay, http):
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
