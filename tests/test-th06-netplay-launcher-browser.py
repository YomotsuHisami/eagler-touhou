from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

from support.launcher_target import launcher_static_server_command


PROJECT = Path(__file__).resolve().parents[1]
WORKSPACE = PROJECT.parent
RELAY_SCRIPT = PROJECT / "server" / "netplay-relay.mjs"


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
            print(f"RELAY {line.rstrip()}")
            if "LAN relay listening" in line:
                return
        elif process.poll() is not None:
            raise RuntimeError(f"relay exited early: {process.returncode}")
        else:
            time.sleep(0.05)
    raise RuntimeError("relay did not start")


def development_manifest(relay_url: str) -> dict:
    source = """
import { createDevelopmentHostManifest } from './lib/development-host-manifest.mjs';
console.log(JSON.stringify(await createDevelopmentHostManifest()));
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", source],
        cwd=PROJECT,
        check=True,
        capture_output=True,
        text=True,
    )
    manifest = json.loads(result.stdout)
    manifest["shared"]["netplayRelay"] = relay_url
    return manifest


def install_manifest_routes(context, manifest: dict) -> None:
    body = json.dumps(manifest)
    context.route(
        "**/host-manifest.json",
        lambda route: route.fulfill(status=200, content_type="application/json", body=body),
    )
    context.route(
        "**/release-catalog.json",
        lambda route: route.fulfill(status=404, body="not published in this development browser test"),
    )


def open_launcher(page, launcher_url: str) -> None:
    page.goto(launcher_url, wait_until="load", timeout=30_000)
    page.wait_for_function("window.__eaglerBoot?.done === true", timeout=30_000)
    first_use_notice = page.locator("#firstUseNoticeDialog")
    if first_use_notice.count() and first_use_notice.evaluate("dialog => dialog.open"):
        page.locator("#firstUseNoticeClose").click()
    page.locator('[data-product="th06mp"]').click()
    page.wait_for_selector("#mpShell:not([hidden])", timeout=10_000)
    assert page.locator("#gameId").inner_text() == "TH06 MP"


def snapshot(page, target_frame: int) -> dict:
    return page.evaluate(
        """target => {
          const frame = document.getElementById('gameFrame');
          const runtime = frame?.contentWindow;
          const hash = runtime?.__eaglerNetplayLanHashes?.[String(target)] || '';
          return {
            frameSrc: String(frame?.src || ''),
            active: runtime?.__eaglerNetplayLanActive === true,
            frame: Number(runtime?.__eaglerNetplayLanFrame || 0),
            confirmed: Number(runtime?.__eaglerNetplayLanConfirmed ?? -1),
            transport: String(runtime?.__eaglerNetplayTransport || ''),
            failed: runtime?.__eaglerNetplayFailed === true,
            error: String(runtime?.__eaglerNetplayError || ''),
            build: String(runtime?.__eaglerNetplayRuntimeBuild || ''),
            mode: String(runtime?.Module?.eaglerOptions?.netplayMode || ''),
            player: Number(runtime?.Module?.eaglerOptions?.netplayPlayer ?? -1),
            players: Number(runtime?.Module?.eaglerOptions?.netplayPlayerCount ?? -1),
            difficulty: Number(runtime?.Module?.eaglerOptions?.netplayDifficulty ?? -1),
            hash: String(hash),
            sessionDiag: String(document.getElementById('runtimeNetplaySessionDiag')?.textContent || ''),
          };
        }""",
        target_frame,
    )


def main() -> None:
    http_port = free_port()
    relay_port = free_port()
    while relay_port == http_port:
        relay_port = free_port()
    launcher_url = f"http://127.0.0.1:{http_port}/"
    relay_url = f"ws://127.0.0.1:{relay_port}/"

    env = os.environ.copy()
    env.update({
        "TH07_RELAY_HOST": "127.0.0.1",
        "TH07_RELAY_PORT": str(relay_port),
        "TH07_RTC_TIMEOUT_MS": "1000",
        "TH07_STUN_URLS": "",
        "TH07_RELAY_DELAY_MS": "25",
        "TH07_RELAY_JITTER_MS": "5",
    })
    http = subprocess.Popen(
        launcher_static_server_command(PROJECT, http_port, [sys.executable, "-m", "http.server", str(http_port), "--bind", "127.0.0.1"]),
        cwd=WORKSPACE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    relay = subprocess.Popen(
        ["node", str(RELAY_SCRIPT)],
        cwd=PROJECT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    browsers = []
    try:
        wait_http(launcher_url)
        wait_relay(relay)
        manifest = development_manifest(relay_url)
        with sync_playwright() as pw:
            pages = []
            failures = [""] * 2
            for index in range(2):
                browser = pw.chromium.launch(
                    headless=True,
                    args=[
                        "--autoplay-policy=no-user-gesture-required",
                        "--disable-background-timer-throttling",
                        "--disable-backgrounding-occluded-windows",
                        "--disable-renderer-backgrounding",
                    ],
                )
                browsers.append(browser)
                context = browser.new_context(viewport={"width": 1280, "height": 900}, service_workers="block")
                install_manifest_routes(context, manifest)
                # RTC mesh is covered by Runtime smoke tests. This Launcher test
                # forces the production transport through the real WS fallback.
                context.add_init_script("delete globalThis.RTCPeerConnection")
                page = context.new_page()
                page.on("pageerror", lambda error, i=index: failures.__setitem__(i, f"pageerror: {error}"))
                page.on("console", lambda message, i=index: (
                    print(f"P{i + 1} {message.text}")
                    if "netplay" in message.text.lower() or message.type == "error" else None
                ))
                pages.append(page)

            for page in pages:
                open_launcher(page, launcher_url)

            p1, p2 = pages
            p1.locator("#mpCreateRoom").click()
            p1.wait_for_selector("#mpRoomView:not([hidden])", timeout=10_000)
            p1.wait_for_selector("#mpLocalPlayer:not([hidden])", timeout=10_000)
            room_code = p1.locator("#mpRoomCode").inner_text()
            if not room_code:
                raise RuntimeError("TH06MP room code was not created")

            p2.locator("#mpJoinCode").fill(room_code)
            p2.locator("#mpJoinRoom").click()
            p2.wait_for_selector("#mpRoomView:not([hidden])", timeout=10_000)
            p2.wait_for_selector('[data-mp-seat-drop="1"] button:not([disabled])', timeout=10_000)
            p2.locator('[data-mp-seat-drop="1"] button').click()
            p2.wait_for_selector("#mpLocalPlayer:not([hidden])", timeout=10_000)

            for page in pages:
                page.locator("#mpReady").click()
                page.wait_for_function("document.querySelector('#mpReady')?.textContent === '已准备'", timeout=10_000)
            p1.wait_for_function("document.querySelector('#mpStartGame')?.disabled === false", timeout=10_000)
            p1.locator("#mpStartGame").click()

            target_frame = 300
            deadline = time.time() + 90.0
            values = None
            while time.time() < deadline:
                if any(failures):
                    break
                values = [snapshot(page, target_frame) for page in pages]
                if any(value["failed"] for value in values):
                    break
                if all(
                    value["active"] and value["frame"] >= target_frame and
                    value["confirmed"] >= target_frame - 1 and value["hash"]
                    for value in values
                ):
                    break
                time.sleep(0.1)

            values = values or [snapshot(page, target_frame) for page in pages]
            if any(failures):
                raise RuntimeError(f"Launcher page failure: {failures}")
            if any(value["failed"] for value in values):
                raise RuntimeError(f"TH06MP Runtime failure: {values}")
            if not all(
                value["active"] and value["frame"] >= target_frame and
                value["confirmed"] >= target_frame - 1 and value["hash"]
                for value in values
            ):
                raise RuntimeError(f"Launcher TH06MP timeout: {values}")
            if len({value["hash"] for value in values}) != 1:
                raise RuntimeError(f"Launcher TH06MP canonical mismatch: {values}")
            for index, value in enumerate(values):
                if "/th06-eagler/build-web-netplay-th06/th06.html" not in value["frameSrc"]:
                    raise RuntimeError(f"P{index + 1} did not launch the isolated TH06MP Runtime: {value}")
                if value["mode"] != "lan" or value["player"] != index or value["players"] != 2:
                    raise RuntimeError(f"P{index + 1} received wrong Launcher netplay options: {value}")
                if value["difficulty"] < 0 or value["difficulty"] > 4:
                    raise RuntimeError(f"P{index + 1} received a TH07-only difficulty: {value}")
                if value["transport"] != "relay":
                    raise RuntimeError(f"P{index + 1} did not use forced WS relay fallback: {value}")
                if not value["build"].startswith("th06mp-"):
                    raise RuntimeError(f"P{index + 1} served wrong Runtime build: {value}")

            print(
                "TH06 Launcher browser netplay: PASS "
                f"room={room_code} frame={target_frame} hash={values[0]['hash']} "
                f"frames={values[0]['frame']}/{values[1]['frame']} "
                f"confirmed={values[0]['confirmed']}/{values[1]['confirmed']}"
            )
    finally:
        for browser in browsers:
            try:
                browser.close()
            except Exception:
                pass
        for process in (relay, http):
            if process.poll() is None:
                process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()


if __name__ == "__main__":
    main()
