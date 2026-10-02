"""Real Launcher UI + local relay. No game-performance or deployment claim."""
from __future__ import annotations
import argparse
import importlib.util
import json
import os
import subprocess
import secrets
import traceback
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("room_fixture", ROOT / "tests/test-mp-runtime-exit-room.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("url", nargs="?")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    http = None
    http_log = (args.output / "http.log").open("w", encoding="utf-8")
    if not args.url:
        http_port = fixture.free_port()
        args.url = f"http://127.0.0.1:{http_port}/"
        http = subprocess.Popen(["node", "scripts/serve.mjs", str(http_port)], cwd=ROOT,
            env={**os.environ, "EAGLER_DEVELOPMENT_GAMES": "th09"}, stdout=http_log, stderr=subprocess.STDOUT)
    port = fixture.free_port()
    log = (args.output / "relay.log").open("w", encoding="utf-8")
    relay = subprocess.Popen(["node", "server/netplay-relay.mjs"], cwd=ROOT,
        env={**os.environ, "EAGLER_NETPLAY_RELAY_HOST": "127.0.0.1",
             "EAGLER_NETPLAY_RELAY_PORT": str(port), "EAGLER_NETPLAY_STUN_URLS": ""},
        stdout=log, stderr=subprocess.STDOUT)
    report = {"passed": False, "scope": __doc__, "errors": [], "layouts": []}
    try:
        fixture.wait_http(args.url)
        fixture.wait_relay(relay, "127.0.0.1", port)
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1280, "height": 850}, service_workers="block")
            manifest = fixture.host_manifest(f"ws://127.0.0.1:{port}/")
            manifest["games"] = {"th09": fixture.host_game("th09", True)}
            context.route("**/host-manifest.json*", lambda route: route.fulfill(
                status=200, content_type="application/json", body=json.dumps(manifest)))
            context.route("**/release-catalog.json*", lambda route: route.fulfill(status=404, body="fixture"))
            page = context.new_page()
            page.on("pageerror", lambda error: report["errors"].append(str(error)))
            def room_url():
                code = secrets.randbelow(9000) + 1000
                return args.url.rstrip('/') + f'/?game=th09mp&mpRoom={code}&fromLobby=1&lobbyAction=create&lobbyPlayers=2&lobbyDifficulty=1'
            page.goto(room_url(), wait_until="load")
            page.wait_for_function("window.__eaglerBoot?.done === true", timeout=30000)
            fixture.close_first_use_notice(page)
            toggle = page.locator("#mpRollbackToggle")
            def dismiss_fixture_notice():
                # The fixture has no playable assets. Dismiss its ordinary
                # resource warning through the real close button before crops.
                if page.locator("#toast.show").count():
                    page.locator("#toastClose").click()
                    page.wait_for_timeout(200)
            page.wait_for_function("document.querySelector('#mpRollbackToggle')?.disabled === false", timeout=10000)
            assert toggle.is_visible() and toggle.get_attribute("aria-checked") == "true"
            assert page.locator("#mpAdonisTiming").is_hidden()
            assert page.locator("#mpInputDelay").input_value() == "auto"
            assert page.locator('#mpInputDelay option[value="auto"]').inner_text() == "自动 · 开局实测"
            page.locator("#mpInputDelay").select_option("9", force=True)
            toggle.click()
            assert toggle.get_attribute("aria-checked") == "false"
            assert page.locator("#mpInputDelay").input_value() == "9"
            toggle.focus()
            page.keyboard.press("Space")
            assert toggle.get_attribute("aria-checked") == "true"
            assert page.locator("#mpInputDelay").input_value() == "9", "Rollback must not rewrite D"
            guest_context = browser.new_context(service_workers="block")
            guest_context.route("**/host-manifest.json*", lambda route: route.fulfill(
                status=200, content_type="application/json", body=json.dumps(manifest)))
            guest_context.route("**/release-catalog.json*", lambda route: route.fulfill(status=404, body="fixture"))
            guest = guest_context.new_page()
            code = parse_qs(urlparse(page.url).query)["mpRoom"][0]
            guest.goto(args.url.rstrip('/') + f'/?game=th09mp&mpRoom={code}&fromLobby=1&lobbyAction=join')
            guest.wait_for_function("window.__eaglerBoot?.done === true", timeout=30000)
            fixture.close_first_use_notice(guest)
            guest.wait_for_selector("#mpRoomView:not([hidden])")
            assert guest.locator("#mpRollbackToggle").is_hidden(), "Do not advertise unannounced host choices"
            assert guest.locator("#mpInputDelay").is_disabled(), "Only host may change D"
            guest_context.close()
            for width, height in ((1280, 850), (960, 720), (390, 844), (320, 740)):
                page.locator("#mpInputDelay").select_option("auto", force=True)
                page.set_viewport_size({"width": width, "height": height})
                page.wait_for_timeout(150)
                geometry = page.locator("#mpInputTiming").evaluate("""row => {
                    const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
                    return {row:rect(row),toggle:rect(row.querySelector('#mpRollbackToggle')),
                        select:rect(row.querySelector('.mizuki-select')),viewport:innerWidth,
                        scrollWidth:document.documentElement.scrollWidth};
                }""")
                report["layouts"].append(geometry)
                assert geometry["toggle"]["right"] <= geometry["select"]["x"] + 1, geometry
                assert abs(geometry["toggle"]["y"] - geometry["select"]["y"]) < 6, geometry
                assert geometry["toggle"]["height"] >= 44, geometry
                assert geometry["select"]["right"] <= width + 1, geometry
                assert geometry["scrollWidth"] <= width + 1, geometry
                dismiss_fixture_notice()
                page.locator("#mpInputTiming").screenshot(path=str(args.output / f"controls-{width}.png"))
            page.locator("#uiLanguageSelect").select_option("en", force=True)
            page.wait_for_function("document.querySelector('#mpRollbackToggle span').textContent === 'Rollback'")
            assert page.locator('#mpInputDelay option[value="auto"]').inner_text() == "Auto · measure at start"
            geometry = page.locator("#mpInputTiming").evaluate("""row => ({
                width:innerWidth,right:row.querySelector('.mizuki-select').getBoundingClientRect().right,
                toggleRight:row.querySelector('#mpRollbackToggle').getBoundingClientRect().right,
                selectLeft:row.querySelector('.mizuki-select').getBoundingClientRect().left})""")
            assert geometry["right"] <= geometry["width"] + 1 and geometry["toggleRight"] <= geometry["selectLeft"], geometry
            dismiss_fixture_notice()
            page.locator("#mpInputTiming").screenshot(path=str(args.output / "controls-320-en.png"))
            page.locator("#uiLanguageSelect").select_option("zh-CN", force=True)
            page.set_viewport_size({"width": 1280, "height": 850})
            dismiss_fixture_notice()
            page.locator("#mpRoomView").screenshot(path=str(args.output / "room-desktop.png"))
            toggle.click()
            page.locator("#mpLeaveRoom").click()
            page.wait_for_url("**/lobby.html?game=th09mp")
            page.goto(room_url(), wait_until="load")
            page.wait_for_function("window.__eaglerBoot?.done === true", timeout=30000)
            fixture.close_first_use_notice(page)
            page.wait_for_function("document.querySelector('#mpRollbackToggle')?.disabled === false")
            assert toggle.get_attribute("aria-checked") == "true", "New rooms reset rollback to enabled"
            assert page.locator("#mpInputDelay").input_value() == "auto"
            assert not report["errors"], report["errors"]
            report["passed"] = True
            context.close()
            browser.close()
    except BaseException as error:
        report["error"] = repr(error)
        report["traceback"] = traceback.format_exc()
        raise
    finally:
        relay.terminate()
        try: relay.wait(timeout=5)
        except subprocess.TimeoutExpired:
            relay.kill()
            relay.wait(timeout=5)
        log.close()
        if http:
            http.terminate()
            try: http.wait(timeout=5)
            except subprocess.TimeoutExpired:
                http.kill()
                http.wait(timeout=5)
        http_log.close()
        (args.output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("TH09 rollback control, keyboard, fixed D and responsive placement: PASS")

if __name__ == "__main__": main()
