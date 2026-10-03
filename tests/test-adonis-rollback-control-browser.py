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

def main(default_game: str | None = None) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("url", nargs="?")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument('--game', choices=['th08','th09','th10'], required=default_game is None, default=default_game)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    http = None
    http_log = (args.output / "http.log").open("w", encoding="utf-8")
    if not args.url:
        http_port = fixture.free_port()
        args.url = f"http://127.0.0.1:{http_port}/"
        http = subprocess.Popen(["node", "scripts/serve.mjs", str(http_port)], cwd=ROOT,
            env={**os.environ, "EAGLER_DEVELOPMENT_GAMES": "th10"}, stdout=http_log, stderr=subprocess.STDOUT)
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
            manifest["games"] = {args.game: fixture.host_game(args.game, args.game=="th08")}
            context.route("**/host-manifest.json*", lambda route: route.fulfill(
                status=200, content_type="application/json", body=json.dumps(manifest)))
            context.route("**/release-catalog.json*", lambda route: route.fulfill(status=404, body="fixture"))
            page = context.new_page()
            page.on("pageerror", lambda error: report["errors"].append(str(error)))
            def room_url():
                code = secrets.randbelow(9000) + 1000
                return args.url.rstrip('/') + f'/?game={args.game}mp&mpRoom={code}&fromLobby=1&lobbyAction=create&lobbyPlayers=2&lobbyDifficulty=1'
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
            assert toggle.is_visible() and toggle.get_attribute("aria-checked") == "false"
            assert page.locator("#mpAdonisTiming").count() == 0
            assert page.locator("#mpInputTiming #mpInputDelay").count() == 0
            assert page.locator("#mpInputDelaySetting").is_hidden()
            page.locator("#mpSettingsRoomDrawerToggle").click()
            page.wait_for_selector("#mpSettingsRoomDrawer:not([hidden])")
            assert page.locator("#mpSettingsFold #mpInputDelaySetting").is_visible()
            assert page.locator("#mpInputDelaySetting small, #mpInputDelaySetting p").count() == 0
            assert page.locator("#mpInputDelay").input_value() == "auto"
            assert page.locator('#mpInputDelay option[value="auto"]').inner_text() == "自动 · 开局实测"
            chosen_delay = "9" if args.game == "th09" else "8"
            page.locator("#mpInputDelay").select_option(chosen_delay, force=True)
            page.locator("#mpSettingsRoomDrawer #libraryBack").click()
            page.wait_for_selector("#mpSettingsRoomDrawer", state="hidden")
            toggle.click()
            assert toggle.get_attribute("aria-checked") == "true"
            assert page.locator("#mpInputDelay").input_value() == chosen_delay
            toggle.focus()
            page.keyboard.press("Space")
            assert toggle.get_attribute("aria-checked") == "false"
            assert page.locator("#mpInputDelay").input_value() == chosen_delay, "Rollback must not rewrite D"
            guest_context = browser.new_context(service_workers="block")
            guest_context.route("**/host-manifest.json*", lambda route: route.fulfill(
                status=200, content_type="application/json", body=json.dumps(manifest)))
            guest_context.route("**/release-catalog.json*", lambda route: route.fulfill(status=404, body="fixture"))
            guest = guest_context.new_page()
            code = parse_qs(urlparse(page.url).query)["mpRoom"][0]
            guest.goto(args.url.rstrip('/') + f'/?game={args.game}mp&mpRoom={code}&fromLobby=1&lobbyAction=join')
            guest.wait_for_function("window.__eaglerBoot?.done === true", timeout=30000)
            fixture.close_first_use_notice(guest)
            guest.wait_for_selector("#mpRoomView:not([hidden])")
            assert guest.locator("#mpRollbackToggle").is_hidden(), "Do not advertise unannounced host choices"
            guest.locator("#mpSettingsRoomDrawerToggle").click()
            guest.wait_for_selector("#mpSettingsRoomDrawer:not([hidden])")
            assert guest.locator("#mpInputDelaySetting").is_visible()
            assert guest.locator("#mpInputDelay").is_disabled(), "Only host may change D"
            guest_context.close()
            for width, height in ((1280, 850), (960, 720), (390, 844), (320, 740)):
                page.locator("#mpInputDelay").select_option("auto", force=True)
                page.set_viewport_size({"width": width, "height": height})
                page.wait_for_timeout(150)
                geometry = page.locator("#mpInputTiming").evaluate("""row => {
                    const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
                    return {row:rect(row),toggle:rect(row.querySelector('#mpRollbackToggle')),
                        viewport:innerWidth,
                        scrollWidth:document.documentElement.scrollWidth};
                }""")
                report["layouts"].append(geometry)
                assert geometry["toggle"]["height"] >= 44, geometry
                assert 0 <= geometry["toggle"]["x"] - geometry["row"]["x"] <= 9, geometry
                assert geometry["toggle"]["right"] <= width + 1, geometry
                assert geometry["scrollWidth"] <= width + 1, geometry
                dismiss_fixture_notice()
                page.locator("#mpInputTiming").screenshot(path=str(args.output / f"controls-{width}.png"))
                page.locator("#mpSettingsRoomDrawerToggle").click()
                page.wait_for_selector("#mpSettingsRoomDrawer:not([hidden])")
                select = page.locator("#mpInputDelaySetting .mizuki-select")
                select.scroll_into_view_if_needed()
                select_geometry = select.bounding_box()
                assert select_geometry and select_geometry["x"] >= 0 and select_geometry["x"] + select_geometry["width"] <= width + 1, select_geometry
                page.locator("#mpInputDelaySetting").screenshot(path=str(args.output / f"input-delay-{width}.png"))
                page.locator("#mpSettingsRoomDrawer #libraryBack").click()
                page.wait_for_selector("#mpSettingsRoomDrawer", state="hidden")
            page.locator("#uiLanguageSelect").select_option("en", force=True)
            page.wait_for_function("document.querySelector('#mpRollbackToggle span').textContent === 'Rollback'")
            assert page.locator('#mpInputDelay option[value="auto"]').inner_text() == "Auto · measure at start"
            dismiss_fixture_notice()
            page.locator("#mpInputTiming").screenshot(path=str(args.output / "controls-320-en.png"))
            page.locator("#mpSettingsRoomDrawerToggle").click()
            page.wait_for_selector("#mpSettingsRoomDrawer:not([hidden])")
            assert page.locator('#mpInputDelaySetting label').inner_text() == "Input delay"
            page.locator("#mpInputDelaySetting").screenshot(path=str(args.output / "input-delay-320-en.png"))
            page.locator("#mpSettingsRoomDrawer #libraryBack").click()
            page.wait_for_selector("#mpSettingsRoomDrawer", state="hidden")
            page.locator("#uiLanguageSelect").select_option("zh-CN", force=True)
            page.set_viewport_size({"width": 1280, "height": 850})
            dismiss_fixture_notice()
            page.locator("#mpRoomView").screenshot(path=str(args.output / "room-desktop.png"))
            toggle.click()
            page.locator("#mpLeaveRoom").click()
            page.wait_for_url("**/lobby.html?game=*mp")
            page.goto(room_url(), wait_until="load")
            page.wait_for_function("window.__eaglerBoot?.done === true", timeout=30000)
            fixture.close_first_use_notice(page)
            page.wait_for_function("document.querySelector('#mpRollbackToggle')?.disabled === false")
            assert toggle.get_attribute("aria-checked") == "false", "New rooms reset rollback to disabled"
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
    print(args.game+" rollback control, keyboard, fixed D and responsive placement: PASS")

if __name__ == "__main__": main()
