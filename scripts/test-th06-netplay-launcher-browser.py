from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


PROJECT = Path(__file__).resolve().parents[1]
WORKSPACE = PROJECT.parent
RELAY_ROOT = WORKSPACE / "th07-eagler" / "tools" / "netplay"


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


def configure_launcher(page, launcher_url: str, relay_url: str, player: int) -> None:
    page.goto(launcher_url, wait_until="load", timeout=30_000)
    changelog = page.locator("#changelogDialog")
    if changelog.count() and changelog.evaluate("dialog => dialog.open"):
        page.locator("#changelogConfirm").click()
    page.locator('.game[data-game="th06"]:not([data-product])').click()
    page.locator("#th07NetplayOption").wait_for(state="visible", timeout=10_000)
    page.locator("#musicSelect").select_option("none")
    page.locator("#runtimeVariantSelect").select_option("multiplayer")
    page.locator("#netplayPlayerCount").select_option("2")
    page.locator("#netplayUrl").fill(relay_url)
    page.locator("#netplayPlayer").select_option(str(player))
    page.locator("#netplaySeed").fill("19005")
    assert page.locator("#launchText").inner_text() == "启动 LAN 联机"
    page.locator("#launch").click()


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
    room = f"th06-launcher-{int(time.time() * 1000)}"
    launcher_url = f"http://127.0.0.1:{http_port}/eagler-touhou/"
    relay_url = f"ws://127.0.0.1:{relay_port}/?room={room}"

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
        [sys.executable, "-m", "http.server", str(http_port), "--bind", "127.0.0.1"],
        cwd=WORKSPACE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    relay = subprocess.Popen(
        ["node", "lan-relay.cjs"],
        cwd=RELAY_ROOT,
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
                context = browser.new_context(viewport={"width": 1280, "height": 900})
                # Force the production transport through the real WS fallback;
                # RTC mesh itself is covered by the Runtime smoke suite. This
                # test is specifically the Launcher -> isolated TH06MP wiring.
                context.add_init_script("delete globalThis.RTCPeerConnection")
                page = context.new_page()
                page.on("pageerror", lambda error, i=index: failures.__setitem__(i, f"pageerror: {error}"))
                page.on("console", lambda message, i=index: (
                    print(f"P{i + 1} {message.text}")
                    if "netplay" in message.text.lower() or message.type == "error" else None
                ))
                pages.append(page)

            for index, page in enumerate(pages):
                configure_launcher(page, launcher_url, relay_url, index)

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
            if {value["hash"] for value in values}.__len__() != 1:
                raise RuntimeError(f"Launcher TH06MP canonical mismatch: {values}")
            for index, value in enumerate(values):
                if "/th06-eagler/build-web-netplay-th06/th06.html" not in value["frameSrc"]:
                    raise RuntimeError(f"P{index + 1} did not launch the isolated TH06MP Runtime: {value}")
                if value["mode"] != "lan" or value["player"] != index or value["players"] != 2:
                    raise RuntimeError(f"P{index + 1} received wrong Launcher netplay options: {value}")
                if value["transport"] != "relay":
                    raise RuntimeError(f"P{index + 1} did not use forced WS relay fallback: {value}")
                if not value["build"].startswith("th06mp-"):
                    raise RuntimeError(f"P{index + 1} served wrong Runtime build: {value}")

            print(
                "TH06 Launcher browser netplay: PASS "
                f"frame={target_frame} hash={values[0]['hash']} "
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
