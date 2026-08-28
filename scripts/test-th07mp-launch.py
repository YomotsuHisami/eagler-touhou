import os
import sys
import time

from playwright.sync_api import sync_playwright


def close_changelog(page):
    if page.locator("#changelogDialog").get_attribute("open") is not None:
        page.locator("#changelogClose").click()


def open_mp(page, url, package_zip=None):
    page.goto(url, wait_until="load", timeout=30000)
    page.wait_for_function("window.__eaglerBoot?.done === true", timeout=30000)
    page.evaluate("""() => {
      localStorage.setItem('eagler-touhou-changelog-seen-20260822-1', '1');
      document.querySelector('#changelogDialog')?.close();
    }""")
    close_changelog(page)
    if package_zip:
        # Model the actual import-only user path: choose ordinary TH07, press
        # the primary "导入游戏资源" action, then import the package from the
        # import-only window. This path marks the acquisition as import-only,
        # so a successful import must NOT transiently launch the normal TH07
        # Runtime before the multiplayer test begins.
        page.locator('button.game-th07:not([data-product="th07mp"])').click()
        page.locator("#musicSelect").select_option("none", force=True)
        page.wait_for_function(
            "() => (document.querySelector('#launchText')?.textContent || '').includes('导入游戏资源')",
            timeout=30000,
        )
        page.locator("#launch").click()
        page.wait_for_function(
            "() => document.querySelector('#gameDataImportWindow')?.hidden === false",
            timeout=30000,
        )
        page.locator("#transferImport").click()
        page.locator("#gameDataImportInput").set_input_files(package_zip)
        page.wait_for_function(
            """async () => {
              const db = await new Promise((resolve, reject) => {
                const request = indexedDB.open('eagler-touhou-package-store-v1');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              });
              try {
                const installation = await new Promise((resolve, reject) => {
                  const request = db.transaction(['installations'], 'readonly')
                    .objectStore('installations').get('th07');
                  request.onsuccess = () => resolve(request.result || null);
                  request.onerror = () => reject(request.error);
                });
                return !!installation?.currentGeneration;
              } finally {
                db.close();
              }
            }""",
            timeout=120000,
        )
        # The one-time changelog may have begun loading before the marker was
        # written and can open asynchronously while the package import runs.
        # Keep this network/gameplay gate independent from that modal timing.
        page.wait_for_timeout(1500)
        page.evaluate("document.querySelector('#changelogDialog')?.close()")
        assert not page.locator("#player").evaluate(
            "element => element.classList.contains('open')"
        ), "import-only package acquisition must not auto-launch normal TH07"

    page.locator('[data-product="th07mp"]').click()
    page.wait_for_selector("#mpShell:not([hidden])")
    page.locator("#mpMusicSelect").select_option("none", force=True)


def netplay_frame(page):
    for frame in page.frames:
        try:
            value = frame.evaluate("() => globalThis.__eaglerNetplayLanActive === true ? (globalThis.__eaglerNetplayLanFrame ?? -1) : -1")
        except Exception:
            continue
        if isinstance(value, (int, float)) and value >= 0:
            return int(value)
    return -1


def netplay_transport(page):
    for frame in page.frames:
        try:
            active = frame.evaluate("() => globalThis.__eaglerNetplayLanActive === true")
            mode = frame.evaluate("() => globalThis.__eaglerNetplayTransport ?? null")
        except Exception:
            continue
        if active and isinstance(mode, str):
            return mode
    return None


def visible_netplay_diagnostics(page):
    ids = [
        "runtimeNetplaySessionDiag",
        "runtimeNetplayRouteDiag",
        "runtimeNetplayFrameDiag",
        "runtimeNetplayRollbackDiag",
        "runtimeNetplayIceDiag",
    ]
    values = []
    for element_id in ids:
        locator = page.locator(f"#{element_id}")
        assert not locator.is_hidden(), f"{element_id} should be visible during TH07MP"
        values.append(locator.inner_text())
    return values


def netplay_path(page):
    for frame in page.frames:
        try:
            active = frame.evaluate("() => globalThis.__eaglerNetplayLanActive === true")
            path = frame.evaluate("() => globalThis.__eaglerNetplayPath ?? null")
        except Exception:
            continue
        if active and isinstance(path, str):
            return path
    return None


def netplay_time_sync(page):
    for frame in page.frames:
        try:
            state = frame.evaluate("""() => ({
              lead: Number.isFinite(Number(globalThis.__eaglerNetplayLanFrameAdvantage))
                ? Number(globalThis.__eaglerNetplayLanFrameAdvantage) : null,
              peers: Array.isArray(globalThis.__eaglerNetplayLanPeerAdvantages)
                ? globalThis.__eaglerNetplayLanPeerAdvantages.filter(Number.isFinite) : []
            })""")
        except Exception:
            continue
        if (isinstance(state, dict) and isinstance(state.get("lead"), (int, float))
                and state.get("peers")):
            return state
    return None


def wait_netplay_progress(pages, target=120, timeout=30):
    deadline = time.monotonic() + timeout
    last = [-1 for _ in pages]
    while time.monotonic() < deadline:
        last = [netplay_frame(page) for page in pages]
        if all(value >= target for value in last):
            return last
        time.sleep(0.25)
    diagnostics = []
    for page in pages:
        def text(selector):
            try:
                return page.locator(selector).inner_text(timeout=1000)
            except Exception:
                return ""
        frame_state = []
        for frame in page.frames:
            try:
                options = frame.evaluate("() => globalThis.Module?.eaglerOptions ?? null")
                lan_active = frame.evaluate("() => globalThis.__eaglerNetplayLanActive ?? null")
                lan_frame = frame.evaluate("() => globalThis.__eaglerNetplayLanFrame ?? null")
            except Exception as error:
                options = {"evaluationError": str(error)}
                lan_active = None
                lan_frame = None
            frame_state.append({"url": frame.url, "options": options, "lanActive": lan_active, "lanFrame": lan_frame})
        diagnostics.append({
            "url": page.url,
            "player_open": page.locator("#player").evaluate("el => el.classList.contains('open')"),
            "player_status": text("#playerStatus"),
            "toast": text("#toastText"),
            "startup_error": text("#startupErrorDialog"),
            "game_frame_src": page.locator("#gameFrame").get_attribute("src"),
            "frames": frame_state,
        })
    raise AssertionError(f"TH07MP frames did not reach {target}: {last}; diagnostics={diagnostics}")


def main():
    positionals = [arg for arg in sys.argv[1:] if not arg.startswith("--package-zip=") and not arg.startswith("--difficulty=")]
    package_arg = next((arg for arg in sys.argv[1:] if arg.startswith("--package-zip=")), "")
    difficulty_arg = next((arg for arg in sys.argv[1:] if arg.startswith("--difficulty=")), "")
    if not positionals:
        raise SystemExit("usage: test-th07mp-launch.py URL [2|3] [--package-zip=PATH] [--difficulty=0..5]")
    url = positionals[0]
    player_count = int(positionals[1]) if len(positionals) > 1 else 2
    if player_count not in (2, 3):
        raise SystemExit("player count must be 2 or 3")
    difficulty = int(difficulty_arg.split("=", 1)[1]) if difficulty_arg else 1
    if difficulty < 0 or difficulty > 5:
        raise SystemExit("difficulty must be in 0..5")
    package_zip = os.path.abspath(package_arg.split("=", 1)[1]) if package_arg else None
    if package_zip and not os.path.isfile(package_zip):
        raise SystemExit(f"package zip not found: {package_zip}")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Model two real endpoints, not two tabs sharing one browser storage
        # partition. Sharing IndexedDB/local runtime state can serialize the
        # Emscripten save/bootstrap path and creates a launcher race that does
        # not exist between a PC and a phone.
        contexts = [browser.new_context(viewport={"width": 1280, "height": 800})
                    for _ in range(player_count)]
        for context in contexts:
            context.add_init_script("""
              try { localStorage.setItem('eagler-touhou-changelog-seen-20260822-1', '1'); } catch {}
            """)
        pages = [context.new_page() for context in contexts]
        errors = [[] for _ in pages]
        consoles = [[] for _ in pages]
        for index, page in enumerate(pages):
            page.on("pageerror", lambda error, index=index: errors[index].append(str(error)))
            page.on("console", lambda message, index=index: consoles[index].append(f"{message.type}: {message.text}"))
            open_mp(page, url, package_zip)

        p1 = pages[0]

        p1.locator("#mpCreateRoom").click()
        p1.wait_for_selector("#mpRoomView:not([hidden])")
        room = p1.locator("#mpRoomCode").inner_text().strip()
        assert room
        p1.wait_for_function("document.querySelector('#mpRoomDifficulty')?.disabled === false", timeout=10000)
        p1.locator("#mpRoomDifficulty").select_option(str(difficulty), force=True)
        p1.wait_for_function(
            "difficulty => document.querySelector('#mpRoomDifficulty')?.value === String(difficulty)",
            arg=difficulty, timeout=10000)
        if player_count == 3:
            p1.wait_for_function("document.querySelector('#mpRoomPlayerCount')?.disabled === false", timeout=10000)
            p1.locator("#mpRoomPlayerCount").select_option("3", force=True)
            p1.wait_for_function("document.querySelector('#mpSeatStage')?.dataset.playerCount === '3'", timeout=10000)

        for index, page in enumerate(pages[1:], start=1):
            page.locator("#mpJoinCode").fill(room)
            page.locator("#mpJoinRoom").click()
            page.wait_for_selector("#mpRoomView:not([hidden])")
            page.locator(f'[data-mp-seat-drop="{index}"] button').click()

        # Give the lobby enough time to make every endpoint see the same seat map.
        for page in pages:
            page.wait_for_function(
                "count => [...document.querySelectorAll('[data-mp-seat]')].slice(0, count).every(seat => seat.classList.contains('occupied'))",
                arg=player_count, timeout=10000)

        for page in pages:
            page.locator("#mpReady").click()
        p1.wait_for_function("!document.querySelector('#mpStartGame').disabled", timeout=10000)

        p1.locator("#mpStartGame").click()
        for page in pages:
            page.wait_for_selector("#player.open", timeout=30000)

        try:
            frames = wait_netplay_progress(pages)
        except Exception as error:
            raise AssertionError(f"{error}; consoles={consoles}") from error
        difficulty_state = [page.locator("#gameFrame").evaluate("""frame => ({
          option: Number(frame.contentWindow?.Module?.eaglerOptions?.netplayDifficulty),
          requested: Number(frame.contentWindow?.__eaglerNetplayRequestedDifficulty),
          gameplay: Number(frame.contentWindow?.__eaglerNetplayGameplayDifficulty),
          stage: Number(frame.contentWindow?.__eaglerNetplayGameplayStage),
        })""") for page in pages]
        expected_stage = 7 if difficulty == 4 else 8 if difficulty == 5 else 1
        for state in difficulty_state:
            assert state["option"] == difficulty, state
            assert state["requested"] == difficulty, state
            assert state["gameplay"] == difficulty, state
            assert state["stage"] == expected_stage, state
        transports = [netplay_transport(page) for page in pages]
        paths = [netplay_path(page) for page in pages]
        diagnostics = [visible_netplay_diagnostics(page) for page in pages]
        time_sync = [netplay_time_sync(page) for page in pages]
        assert transports == ["rtc"] * player_count, f"expected RTC transport, got {transports}"
        assert paths == ["direct"] * player_count, f"expected direct ICE path in local test, got {paths}"
        for peer_diagnostics in diagnostics:
            assert "runtime multiplayer/lan" in peer_diagnostics[0], peer_diagnostics
            assert "网络 RTC" in peer_diagnostics[1] and f"peers {player_count - 1}/{player_count - 1} ready" in peer_diagnostics[1], peer_diagnostics
            assert "同步 F" in peer_diagnostics[2] and "gap " in peer_diagnostics[2] and "pred " in peer_diagnostics[2], peer_diagnostics
            assert "回滚 " in peer_diagnostics[3] and "pace " in peer_diagnostics[3], peer_diagnostics
            assert "ICE P" in peer_diagnostics[4] and "direct/udp" in peer_diagnostics[4], peer_diagnostics
        for endpoint_errors in errors:
            assert not endpoint_errors, endpoint_errors
        for state in time_sync:
            assert state and state["peers"], state
            assert abs(state["lead"] - max(state["peers"])) < 0.1, state
        print(f"TH07MP launch: PASS room={room} difficulty={difficulty} difficulty_state={difficulty_state} frames={frames} transports={transports} paths={paths} time_sync={time_sync} diagnostics={diagnostics}")
        for context in contexts:
            context.close()
        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
