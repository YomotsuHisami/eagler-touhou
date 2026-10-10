from __future__ import annotations

import os
import socket
import subprocess
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

from support.launcher_target import launcher_server_command


PROJECT = Path(__file__).resolve().parents[1]


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_http(url: str) -> None:
    import urllib.request
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=.5) as response:
                if response.status < 400:
                    return
        except Exception:
            time.sleep(.1)
    raise RuntimeError("Launcher HTTP server did not start")


def confirm_decisions(page, timeout: float = 5.0) -> int:
    """Accept any launch warning (music-off / touch) the Launcher raises.

    The dialog is animated, so a dialog that is already closing must not turn
    into a 30s wait for an invisible button.
    """
    selector = "#decisionDialog[open]:not(.closing)"
    accepted = 0
    deadline = time.time() + timeout
    while time.time() < deadline:
        dialog = page.locator(selector)
        if not dialog.count():
            if accepted:
                return accepted
            page.wait_for_timeout(100)
            continue
        try:
            dialog.locator("#decisionConfirm").click(timeout=1500)
        except PlaywrightTimeoutError:
            if not page.locator(selector).count():
                accepted += 1
                deadline = time.time() + 1.5
                continue
            raise
        accepted += 1
        deadline = time.time() + 1.5
    return accepted


RUNTIME_STUB = r"""<!doctype html><meta charset="utf-8"><script>
(() => {
  const protocol = 'eagler-touhou/1', game = 'th09';
  const epoch = Number(new URLSearchParams(location.search).get('runtimeEpoch'));
  const multiplayer = location.pathname.includes('/multiplayer/');
  window.__th09TestMessages = [];
  window.addEventListener('message', event => {
    const message = event.data || {};
    if (event.origin !== location.origin || message.protocol !== protocol ||
        message.game !== game || message.epoch !== epoch) return;
    window.__th09TestMessages.push(message);
    event.source.postMessage({protocol, game, epoch, request: message.request, ok: true}, event.origin);
    if (message.command === 'launch') queueMicrotask(() => {
      parent.postMessage({protocol, game, epoch, event: 'first-frame'}, location.origin);
      // Only the normal Runtime advertises the title's versus entry, which is
      // what makes the Launcher open the in-game room dialog.
      if (!multiplayer) parent.postMessage({protocol, game, epoch, event: 'network-request'}, location.origin);
    });
  });
  parent.postMessage({protocol, game, epoch, event: 'ready'}, location.origin);
})();
</script>"""

DIAGNOSTICS = """() => ({
  src: document.querySelector('#gameFrame')?.src,
  messages: document.querySelector('#gameFrame')?.contentWindow?.__th09TestMessages,
  toast: document.querySelector('#toast')?.textContent,
  status: document.querySelector('#playerStatus')?.textContent,
  dialog: document.querySelector('#th09NetworkDialog')?.hidden,
  room: document.querySelector('#mpRoomView')?.hidden,
  body: document.body.innerText.slice(-1200)})"""


def open_page(browser, url, errors, name):
    context = browser.new_context(viewport={"width": 1280, "height": 900}, service_workers="block")
    context.route("**/th09.html*", lambda route: route.fulfill(
        status=200, content_type="text/html", body=RUNTIME_STUB))
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(f"{name}: {error}"))
    page.goto(url, wait_until="load", timeout=30_000)
    page.wait_for_function("window.__eaglerBoot?.done === true", timeout=30_000)
    notice = page.locator("#firstUseNoticeDialog")
    if notice.count() and notice.evaluate("dialog => dialog.open"):
        page.locator("#firstUseNoticeClose").click()
    return page


def enter_room_from_title(page, errors, code=None) -> str:
    """In-game entry: start TH09 normally, then use its versus room dialog."""
    card = '.game[data-game="th09"]:not([data-product])'
    if page.locator(card).count() == 0:
        cards = page.evaluate("[...document.querySelectorAll('.game')].map(e => e.outerHTML.slice(0, 350))")
        raise RuntimeError(f"TH09 card missing: errors={errors} cards={cards}")
    page.locator(card).click()
    page.locator("#musicSelect").select_option("none", force=True)
    page.locator("#launch").click()
    if not confirm_decisions(page):
        raise RuntimeError("TH09 normal Runtime launch never asked for the music-off confirmation")
    try:
        page.wait_for_selector("#th09NetworkDialog:not([hidden])", timeout=30_000)
    except Exception as error:
        raise RuntimeError(f"TH09 normal Runtime did not open the versus dialog: {page.evaluate(DIAGNOSTICS)} errors={errors}") from error
    if code is None:
        page.locator("#th09NetworkCreate").click()
    else:
        page.locator("#th09NetworkCode").fill(code)
        page.locator("#th09NetworkJoin").click()
    page.wait_for_selector("#th09NetworkRoom:not([hidden]) #mpRoomView:not([hidden])", timeout=10_000)
    return page.locator("#mpRoomCode").inner_text()


def enter_room_from_launcher(page, errors, code=None) -> str:
    """Launcher entry: the TH09 multiplayer product card and its room view."""
    page.locator('[data-product="th09mp"]').click()
    page.locator("#mpMusicSelect").select_option("none", force=True)
    if code is None:
        page.locator("#mpCreateRoom").click()
    else:
        page.locator("#mpJoinCode").fill(code)
        page.locator("#mpJoinRoom").click()
    page.wait_for_selector("#mpRoomView:not([hidden])", timeout=10_000)
    return page.locator("#mpRoomCode").inner_text()


def run_scenario(browser, url, label, host_entry, joiner_entry, expected_players):
    """One full mixed-entry match: one seat created from each entry point."""
    errors: list[str] = []
    host = open_page(browser, url, errors, f"{label}/host")
    joiner = open_page(browser, url, errors, f"{label}/joiner")
    pages = (host, joiner)
    try:
        code = host_entry(host, errors, None)
        assert len(code) == 4 and code.isdigit(), (label, code)
        joined = joiner_entry(joiner, errors, code)
        assert joined == code, (label, code, joined, joiner.url, joiner.evaluate(DIAGNOSTICS))

        joiner.wait_for_selector('[data-mp-seat-drop="1"] button:not([disabled])', timeout=10_000)
        joiner.locator('[data-mp-seat-drop="1"] button').click()
        host.locator("#mpLoadoutNextSeat").click()
        joiner.locator("#mpLoadoutNextSeat").click()
        for page in pages:
            page.locator("#mpReady").click()
        host.wait_for_function("document.querySelector('#mpStartGame')?.disabled === false", timeout=10_000)
        host.locator("#mpStartGame").click()
        for page in pages:
            confirm_decisions(page)

        expected = []
        for page in pages:
            try:
                page.wait_for_function(
                    "document.querySelector('#gameFrame')?.contentWindow?.__th09TestMessages"
                    "?.some(m => m.command === 'launch') &&"
                    " document.querySelector('#gameFrame')?.contentWindow?.__th09TestMessages"
                    "?.some(m => m.command === 'configure' && m.options?.netplayMode === 'lan')",
                    timeout=30_000)
            except Exception as error:
                raise RuntimeError(f"{label}: TH09 runtime did not start: {page.evaluate(DIAGNOSTICS)} errors={errors}") from error
            expected.append(page.locator("#gameFrame").evaluate(
                "frame => frame.contentWindow.__th09TestMessages.find(m => m.command === 'configure' && m.options?.netplayMode === 'lan').options"))

        assert [c["netplayPlayer"] for c in expected] == list(expected_players), expected
        assert all(c["netplayPlayerCount"] == 2 for c in expected), expected
        assert all(f"room=th09mp-{code}" in c["netplayUrl"] for c in expected), expected
        assert expected[0]["netplayLoadouts"] == expected[1]["netplayLoadouts"], expected
        assert not errors, errors
        print(f"TH09 mixed entry Launcher browser contract: PASS {label} room={code}")
    finally:
        for page in pages:
            page.context.close()


def main() -> None:
    http_port, relay_port = free_port(), free_port()
    while relay_port == http_port:
        relay_port = free_port()
    url = f"http://127.0.0.1:{http_port}/"
    relay_url = f"ws://127.0.0.1:{relay_port}/"
    http_env = os.environ.copy()
    http_env.update({"EAGLER_DEVELOPMENT_GAMES": "th09",
                     "EAGLER_TH09_CONTENT_DIR": str(PROJECT.parent / "games" / "th09"),
                     "EAGLER_TOUHOU_NETPLAY_RELAY": relay_url})
    http = subprocess.Popen(launcher_server_command(PROJECT, http_port), cwd=PROJECT,
                            env=http_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    env = os.environ.copy()
    env.update({"TH07_RELAY_HOST": "127.0.0.1", "TH07_RELAY_PORT": str(relay_port),
                "TH07_STUN_URLS": "", "TH07_RTC_TIMEOUT_MS": "1000"})
    relay = subprocess.Popen(["node", "server/netplay-relay.mjs"], cwd=PROJECT, env=env,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_http(url)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                # The in-game "妖怪対妖怪" dialog hosts, the Launcher card joins.
                run_scenario(browser, url, "title-host/launcher-join",
                             enter_room_from_title, enter_room_from_launcher, (0, 1))
                # ...and the reverse: Launcher hosts, the in-game dialog joins
                # with the same four-digit room code.
                run_scenario(browser, url, "launcher-host/title-join",
                             enter_room_from_launcher, enter_room_from_title, (0, 1))
            finally:
                browser.close()
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
    main()
