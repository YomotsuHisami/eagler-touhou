"""TH20 offline-package import gate.

The Launcher's Package Store must install a retail archive that exceeds one
IndexedDB value (TH20's `th20.data` is 144 MiB against Chromium's 127 MiB
structured-clone ceiling), and the imported generation must then boot the real
Runtime. This test runs against a development host that deliberately provides no
content root, so the imported Package is the only way to play.

Usage: python tests/test-th20-import-launch-browser.py [--package-zip=PATH]
"""
from __future__ import annotations

import os
import re
import socket
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

PROJECT = Path(__file__).resolve().parents[1]
WORKSPACE = PROJECT.parent
DEFAULT_PACKAGE = WORKSPACE / "games" / "th20-import-package-ogg.zip"
FRAME_TARGET = 60


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_http(url: str, timeout: float = 120.0) -> None:
    import urllib.request
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status < 400:
                    return
        except Exception:
            time.sleep(.25)
    raise RuntimeError("Launcher HTTP server did not start")


def confirm_decisions(page, timeout: float = 60.0) -> None:
    selector = "#decisionDialog[open]:not(.closing)"
    deadline = time.time() + timeout
    while time.time() < deadline:
        dialog = page.locator(selector)
        if dialog.count():
            try:
                dialog.locator("#decisionConfirm").click(timeout=1500)
            except PlaywrightTimeoutError:
                pass
            continue
        if page.locator("#player").evaluate("el => el.classList.contains('open')"):
            return
        page.wait_for_timeout(150)


def runtime_state(page) -> dict | None:
    for frame in page.frames:
        try:
            state = frame.evaluate("""() => {
              const runtime = globalThis.__th20Runtime;
              if (!runtime?.core) return null;
              const core = runtime.core;
              // The TH20 shell counts presented frames; sdl_game_status() only
              // reports the current scene, so use the presentation counter.
              const presented = new Uint32Array(core.memory.buffer, core.sdl_stats(), 6)[5];
              const scene = new Int32Array(core.memory.buffer, core.sdl_game_status(), 1)[0];
              return {src: location.href, presented, scene};
            }""")
        except Exception:
            continue
        if isinstance(state, dict):
            return state
    return None


def main() -> None:
    package = Path(next((arg.split("=", 1)[1] for arg in sys.argv[1:] if arg.startswith("--package-zip=")), DEFAULT_PACKAGE))
    if not package.is_file():
        raise SystemExit(f"TH20 package not found: {package}")
    port = free_port()
    url = f"http://127.0.0.1:{port}/?game=th20"
    env = os.environ.copy()
    env.update({
        "EAGLER_DEVELOPMENT_GAMES": "th20",
        "EAGLER_DEVELOPMENT_VANILLA_FONT": str(WORKSPACE / "prepared" / "eagler-touhou-hosted-five-games-20260924" / "shared" / "msgothic.ttc"),
        "EAGLER_DEVELOPMENT_UNICODE_FONT": str(WORKSPACE / "prepared" / "eagler-touhou-hosted-five-games-20260924" / "shared" / "unifont.otf"),
    })
    # No EAGLER_TH20_CONTENT_DIR: the host offers identity only, so playing
    # requires installing the Package exactly like an end user does.
    env.pop("EAGLER_TH20_CONTENT_DIR", None)
    server = subprocess.Popen(["node", "scripts/serve.mjs", str(port)], cwd=PROJECT, env=env,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_http(f"http://127.0.0.1:{port}/")
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            errors: list[str] = []
            # The development host publishes only TH20, so the shared library rail
            # requests the other products' card art and gets 404s; the TH20 Runtime
            # also prints its boot diagnostics through console.error. Chromium's
            # generic "Failed to load resource" console line carries no URL, so the
            # response listener below owns HTTP failures.
            benign = re.compile(r"^(?:Failed to load resource|th20 wasm build|sdl_game_open|tick \d+ scene \d+|worker\[)")
            missing_card_art = re.compile(r"/assets/th\d+-card\.webp$")
            page.on("pageerror", lambda error: errors.append(f"pageerror:{error}"))
            page.on("console", lambda message: errors.append(f"{message.type}:{message.text}")
                    if message.type == "error" and not benign.search(message.text) else None)
            page.on("response", lambda response: errors.append(f"http{response.status}:{response.url}")
                    if response.status >= 400 and not missing_card_art.search(response.url) else None)
            page.add_init_script("""
              window.__idbErrors = [];
              const original = IDBDatabase.prototype.transaction;
              IDBDatabase.prototype.transaction = function (...args) {
                const tx = original.apply(this, args);
                tx.addEventListener('error', () => window.__idbErrors.push(tx.error ? `${tx.error.name}: ${tx.error.message}` : 'transaction failed'));
                return tx;
              };
            """)
            try:
                page.goto(url, wait_until="load", timeout=60_000)
                page.wait_for_function("window.__eaglerBoot?.done === true", timeout=90_000)
                page.wait_for_timeout(800)
                page.evaluate("document.querySelector('#firstUseNoticeDialog')?.close()")
                page.locator("#gamePackageImport").click(timeout=20_000)
                page.wait_for_function("() => document.querySelector('#gameDataImportWindow')?.hidden === false", timeout=20_000)
                if page.locator("#transferImport").count():
                    page.locator("#transferImport").click(timeout=20_000)
                started = time.time()
                page.locator("#gameDataImportInput").set_input_files(str(package))
                while time.time() - started < 900:
                    state = page.evaluate("""() => ({
                      busy: document.querySelector('#gameDataImportBusy')?.hidden === false,
                      hidden: document.querySelector('#gameDataImportWindow')?.hidden,
                      status: document.querySelector('#playerStatus')?.textContent || '',
                    })""")
                    if not state["busy"] and state["hidden"]:
                        break
                    page.wait_for_timeout(1000)
                else:
                    raise RuntimeError(f"package import did not finish: {state}")
                assert not page.evaluate("window.__idbErrors"), page.evaluate("window.__idbErrors")
                # OGG only becomes selectable once the imported component is registered.
                options = page.evaluate("[...document.querySelectorAll('#musicSelect option')].map(o => ({v:o.value, disabled:o.disabled}))")
                ogg = [option for option in options if "ogg" in option["v"] and not option["disabled"]]
                assert ogg, f"imported OGG component was not registered: {options}"
                page.locator("#musicSelect").select_option(ogg[0]["v"], force=True)
                page.locator("#launch").click(timeout=20_000)
                confirm_decisions(page)
                page.wait_for_selector("#player.open", timeout=60_000)
                deadline = time.time() + 180
                state = None
                while time.time() < deadline:
                    state = runtime_state(page)
                    if state and isinstance(state.get("presented"), int) and state["presented"] >= FRAME_TARGET:
                        break
                    page.wait_for_timeout(500)
                assert state, "TH20 Runtime never reported itself"
                assert isinstance(state.get("presented"), int) and state["presented"] >= FRAME_TARGET, state
                assert "managedData=1" in state["src"], state
                assert not errors, errors
                print(f"TH20 imported-package launch: PASS package={package.name} music={ogg[0]['v']} "
                      f"presented={state['presented']} scene={state['scene']} import={time.time() - started:.0f}s")
            finally:
                browser.close()
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=10)


if __name__ == "__main__":
    main()
