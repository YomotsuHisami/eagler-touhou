import argparse
from importlib.metadata import version as package_version
import json
import os
import sys
import time
from urllib.parse import parse_qs, quote, urlparse

from playwright.sync_api import sync_playwright


def is_runtime_frame(frame_src: str, game: str) -> bool:
    path = urlparse(frame_src or "").path
    return path.endswith(f"/runtime/{game}/{game}.html") or path.endswith(
        f"/games/{game}/{game}.html"
    )


def runtime_generation(frame_src: str, game: str) -> str:
    parsed = urlparse(frame_src or "")
    if not is_runtime_frame(frame_src, game):
        return ""
    return parse_qs(parsed.query).get("gameGeneration", [""])[0]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url", nargs="?", default="http://127.0.0.1:8136/eagler-touhou/")
    parser.add_argument("game", nargs="?", default="th07")
    parser.add_argument("music", nargs="?", default="none")
    parser.add_argument("--browserstack-device")
    parser.add_argument("--browserstack-os-version")
    parser.add_argument("--browserstack-local-identifier")
    parser.add_argument("--package-zip")
    parser.add_argument("--block-game-data", action="store_true")
    args = parser.parse_args()

    if not args.game.startswith("th") or len(args.game) != 4:
        raise SystemExit("invalid game id")
    if args.music not in {"midi", "ogg-stream", "ogg-full", "none"}:
        raise SystemExit("invalid music mode")

    browserstack_enabled = bool(args.browserstack_device or args.browserstack_os_version)
    if browserstack_enabled and not (args.browserstack_device and args.browserstack_os_version):
        raise SystemExit(
            "BrowserStack requires --browserstack-device and --browserstack-os-version"
        )
    browserstack_local_enabled = bool(args.browserstack_local_identifier)

    console_errors = []
    console_warnings = []
    page_errors = []
    request_failures = []
    response_diagnostics = []

    with sync_playwright() as p:
        if browserstack_enabled:
            username = os.environ.get("BROWSERSTACK_USERNAME", "").strip()
            access_key = os.environ.get("BROWSERSTACK_ACCESS_KEY", "").strip()
            if not username or not access_key:
                raise SystemExit(
                    "BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY must be set"
                )
            capabilities = {
                "browser": "safari",
                "deviceName": args.browserstack_device,
                "osVersion": args.browserstack_os_version,
                "realMobile": "true",
                "name": f"Touhou Eagler {args.game} real iOS gate",
                "build": os.environ.get(
                    "BROWSERSTACK_BUILD_NAME", "touhou-eagler-real-ios"
                ),
                "browserstack.username": username,
                "browserstack.accessKey": access_key,
                "client.playwrightVersion": package_version("playwright"),
            }
            if browserstack_local_enabled:
                capabilities.update(
                    {
                        "browserstack.local": "true",
                        "browserstack.localIdentifier": args.browserstack_local_identifier,
                    }
                )
            endpoint = (
                "wss://cdp.browserstack.com/playwright?caps="
                + quote(json.dumps(capabilities, separators=(",", ":")))
            )
            browser = p.webkit.connect(endpoint, timeout=120_000)
            # Preserve the physical device's own viewport, touch model and UA.
            # Overriding them here would turn a real-iOS run back into emulation.
            context = browser.new_context()
        else:
            browser = p.webkit.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 844, "height": 390},
                user_agent=(
                    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) "
                    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 "
                    "Mobile/15E148 Safari/604.1"
                ),
                has_touch=True,
                is_mobile=True,
                device_scale_factor=3,
            )
        page = context.new_page()
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else console_warnings.append(msg.text) if msg.type == "warning" else None)
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on(
            "requestfailed",
            lambda request: request_failures.append(
                f"{request.method} {request.url}: {request.failure}"
            ),
        )
        page.on(
            "response",
            lambda response: response_diagnostics.append(
                {"status": response.status, "url": response.url}
            )
            if response.status >= 400
            or any(
                marker in response.url.lower()
                for marker in ["release", "package", "/games/", ".data", ".wasm"]
            )
            else None,
        )
        if args.block_game_data:
            page.route(
                "**/*.data*",
                lambda route, request: route.abort()
                if "/games/" in request.url.lower()
                else route.continue_(),
            )

        test_url = args.url + ("&" if "?" in args.url else "?") + f"test=playwright-webkit-{args.game}-{int(time.time())}"
        navigation_response = None
        try:
            navigation_response = page.goto(test_url, wait_until="load", timeout=30000)
            page.wait_for_function(
                "window.__eaglerBoot?.done === true && !!document.getElementById('launch')",
                timeout=30000,
            )
        except Exception as error:
            artifact_dir = os.path.abspath(
                os.path.join(os.path.dirname(__file__), "..", "artifacts")
            )
            os.makedirs(artifact_dir, exist_ok=True)
            screenshot_path = os.path.join(
                artifact_dir, f"browserstack-ios-{args.game}-launcher-boot-failure.png"
            )
            screenshot_error = ""
            try:
                page.screenshot(path=screenshot_path, full_page=True)
            except Exception as capture_error:
                screenshot_error = str(capture_error)
                screenshot_path = ""
            try:
                page_state = page.evaluate(
                    """
                    () => ({
                      readyState: document.readyState,
                      hasBoot: typeof window.__eaglerBoot !== 'undefined',
                      boot: window.__eaglerBoot || null,
                      hasLaunch: !!document.getElementById('launch'),
                      title: document.title,
                      bodyText: (document.body?.innerText || '').slice(0, 1200),
                      scripts: [...document.scripts].map(script => script.src).filter(Boolean),
                      toastHistory: window.__pwToastHistory || [],
                      serviceWorker: 'serviceWorker' in navigator ? {
                        controller: !!navigator.serviceWorker.controller,
                        registrations: await navigator.serviceWorker.getRegistrations().then(items => items.map(registration => ({
                          scope: registration.scope,
                          active: registration.active?.scriptURL || '',
                          state: registration.active?.state || '',
                        }))),
                      } : null,
                      indexedDb: 'databases' in indexedDB
                        ? (await indexedDB.databases()).map(database => database.name).filter(Boolean)
                        : [],
                    })
                    """
                )
            except Exception as state_error:
                page_state = {"evaluationError": str(state_error)}
            diagnostic = {
                "phase": "launcher-boot",
                "error": str(error),
                "url": page.url,
                "navigationStatus": (
                    navigation_response.status if navigation_response else None
                ),
                "page": page_state,
                "requestFailures": request_failures[-30:],
                "responses": response_diagnostics[-50:],
                "consoleErrors": console_errors,
                "consoleWarnings": console_warnings,
                "pageErrors": page_errors,
                "screenshot": screenshot_path,
                "screenshotError": screenshot_error,
            }
            print(
                "Playwright WebKit Launcher: FAIL "
                + json.dumps(diagnostic, ensure_ascii=False)
            )
            browser.close()
            return 2

        capabilities = page.evaluate(
            """
            () => ({
              audioContext: typeof window.AudioContext,
              webkitAudioContext: typeof window.webkitAudioContext,
              offlineAudioContext: typeof window.OfflineAudioContext,
              indexedDB: typeof window.indexedDB,
              blob: typeof window.Blob,
              urlCreateObjectURL: typeof URL.createObjectURL,
              webAssembly: typeof window.WebAssembly,
              ua: navigator.userAgent,
            })
            """
        )
        audio_available = (
            capabilities["audioContext"] == "function"
            or capabilities["webkitAudioContext"] == "function"
        )

        page.evaluate(
            """
            () => {
              localStorage.setItem('eagler-touhou-changelog-seen-20260822-1', '1');
              document.querySelector('#changelogDialog')?.close();
              window.__pwFirstFrame = false;
              window.__pwToastHistory = [];
              const toast = document.getElementById('toast');
              const recordToast = () => {
                const text = toast?.textContent?.trim() || '';
                if (text && window.__pwToastHistory.at(-1) !== text) {
                  window.__pwToastHistory.push(text);
                }
              };
              recordToast();
              if (toast) new MutationObserver(recordToast).observe(toast, {
                subtree: true,
                childList: true,
                characterData: true,
                attributes: true,
              });
              window.addEventListener('message', event => {
                const m = event.data || {};
                if (m.protocol === 'eagler-touhou/1' && m.event === 'first-frame') {
                  window.__pwFirstFrame = true;
                }
              });
            }
            """
        )
        page.wait_for_timeout(150)
        page.evaluate("document.querySelector('#changelogDialog')?.close()")

        page.evaluate(
            "(game) => document.querySelector(`[data-game='${game}']`)?.click()",
            args.game,
        )
        requested_music = args.music
        effective_music = requested_music if audio_available else "none"
        page.evaluate(
            """(music) => {
              const select = document.getElementById('musicSelect');
              if (!select) throw new Error('musicSelect missing');
              select.value = music;
              select.dispatchEvent(new Event('change', { bubbles: true }));
            }""",
            effective_music,
        )

        package_uploaded = False
        package_upload_attempted = False
        package_upload_error = ""
        package_input_events = None
        launch_clicked = False
        if args.package_zip:
            package_upload_attempted = True
            try:
                package_zip = os.path.abspath(args.package_zip)
                if not os.path.isfile(package_zip):
                    raise FileNotFoundError(package_zip)
                # Import from the Launcher's always-available package action
                # before starting the hosted acquisition path.  Waiting for a
                # failed hosted download first is both slower and unreliable on
                # real iOS, where the fallback dialog can remain hidden while
                # the transfer is stalled at zero bytes.
                page.evaluate("document.getElementById('gamePackageImport')?.click()")
                page.locator("#gameDataImportWindow").wait_for(
                    state="visible", timeout=10000
                )
                page.evaluate(
                    """() => {
                      const input = document.getElementById('gameDataImportInput');
                      window.__pwPackageInputEvents = { input: 0, change: 0 };
                      input.addEventListener('input', () => window.__pwPackageInputEvents.input++);
                      input.addEventListener('change', () => window.__pwPackageInputEvents.change++);
                    }"""
                )
                page.locator("#gameDataImportInput").set_input_files(
                    package_zip, timeout=180000
                )
                page.wait_for_timeout(500)
                package_input_events = page.evaluate(
                    """() => ({
                      ...window.__pwPackageInputEvents,
                      files: document.getElementById('gameDataImportInput')?.files?.length || 0,
                    })"""
                )
                # BrowserStack's real-iOS bridge can assign the FileList
                # without emitting the DOM change event that starts the
                # Launcher's importer.  Emit it only when the page proves no
                # native change event was delivered.
                if package_input_events["change"] == 0:
                    page.evaluate(
                        "document.getElementById('gameDataImportInput')?.dispatchEvent(new Event('change', { bubbles: true }))"
                    )
                    page.wait_for_timeout(500)
                    package_input_events = page.evaluate(
                        """() => ({
                          ...window.__pwPackageInputEvents,
                          files: document.getElementById('gameDataImportInput')?.files?.length || 0,
                        })"""
                    )
                package_uploaded = True
            except Exception as upload_error:
                package_upload_error = str(upload_error)
        else:
            page.evaluate("document.getElementById('launch')?.click()")
            launch_clicked = True

        deadline = time.time() + (300 if browserstack_enabled and args.package_zip else 120)
        last = None
        first_generation = ""
        while time.time() < deadline:
            try:
                if page.locator("#decisionDialog").evaluate("d => d.open"):
                    page.locator("#decisionConfirm").click()
            except Exception:
                pass

            last = page.evaluate(
                """
                () => ({
                  status: document.getElementById('playerStatus')?.textContent || '',
                  hostStatus: document.getElementById('status')?.textContent || '',
                  startupError: document.getElementById('startupErrorText')?.textContent || '',
                  toast: document.getElementById('toast')?.textContent || '',
                  music: document.getElementById('musicSelect')?.value || '',
                  transfer: document.getElementById('transferLabel')?.textContent || '',
                  frameSrc: document.getElementById('gameFrame')?.src || '',
                  playerOpen: document.getElementById('player')?.classList.contains('open') || false,
                  importWindowHidden: document.getElementById('gameDataImportWindow')?.hidden ?? null,
                  importButtonDisabled: document.getElementById('transferImport')?.disabled ?? null,
                  firstFrame: window.__pwFirstFrame === true,
                })
                """
            )

            if (
                package_uploaded
                and not launch_clicked
                and "可以启动游戏" in last["hostStatus"]
            ):
                page.evaluate("document.getElementById('launch')?.click()")
                launch_clicked = True
                page.wait_for_timeout(500)
                continue

            if (
                args.package_zip
                and not package_upload_attempted
                and time.time() - (deadline - 120) > 10
            ):
                package_upload_attempted = True
                try:
                    # A fresh public session may still be waiting for the
                    # unavailable hosted Package. Cancel that acquisition so
                    # the app exposes its manual-import control.
                    cancel = page.locator("#transferCancel")
                    if cancel.is_visible():
                        cancel.click(timeout=10000)
                        page.wait_for_timeout(1000)
                    import_button = page.locator("#transferImport")
                    if not import_button.is_visible():
                        raise RuntimeError("manual package import control is not visible")
                    package_zip = os.path.abspath(args.package_zip)
                    if not os.path.isfile(package_zip):
                        raise FileNotFoundError(package_zip)
                    import_button.click(timeout=10000)
                    page.locator("#gameDataImportInput").set_input_files(
                        package_zip, timeout=180000
                    )
                    package_uploaded = True
                    page.wait_for_timeout(500)
                    continue
                except Exception as upload_error:
                    package_upload_error = str(upload_error)

            if (
                last["firstFrame"]
                and last["status"] == "运行中"
                and is_runtime_frame(last["frameSrc"], args.game)
                and "managedData=1" in last["frameSrc"]
            ):
                first_generation = runtime_generation(last["frameSrc"], args.game)
                break

            if is_runtime_frame(last["frameSrc"], args.game) and "managedData=1" not in last["frameSrc"] and last["playerOpen"]:
                if args.package_zip and not package_uploaded:
                    try:
                        package_zip = os.path.abspath(args.package_zip)
                        if not os.path.isfile(package_zip):
                            raise FileNotFoundError(package_zip)
                        page.locator("#transferImport").click(timeout=10000)
                        page.locator("#gameDataImportInput").set_input_files(
                            package_zip, timeout=180000
                        )
                        package_uploaded = True
                        page.wait_for_timeout(500)
                        continue
                    except Exception as upload_error:
                        package_upload_error = str(upload_error)
                break

            combined = "\n".join(
                [last["status"], last["hostStatus"], last["startupError"]]
            )
            if any(
                token.lower() in combined.lower()
                for token in [
                    "referenceerror",
                    "typeerror",
                    "not supported",
                    "失败",
                    "错误",
                    "超时",
                ]
            ):
                break
            time.sleep(0.25)

        if not first_generation:
            frame_states = []
            for child_frame in page.frames:
                if child_frame == page.main_frame or not is_runtime_frame(child_frame.url, args.game):
                    continue
                try:
                    frame_states.append(
                        child_frame.evaluate(
                            """
                            () => ({
                              url: location.href,
                              readyState: document.readyState,
                              title: document.title,
                              bodyText: (document.body?.innerText || '').slice(0, 1200),
                              canvas: !!document.querySelector('canvas'),
                              moduleType: typeof window.Module,
                              moduleCalledRun: window.Module?.calledRun ?? null,
                              moduleRuntimeInitialized: window.Module?.runtimeInitialized ?? null,
                              wasmMemory: window.Module?.wasmMemory?.buffer?.byteLength ?? null,
                              managedData: window.__eaglerManagedDataState || null,
                              getPreloadedPackage: typeof window.Module?.getPreloadedPackage,
                              expectedDataFileDownloads: window.Module?.expectedDataFileDownloads ?? null,
                              dataFileDownloads: window.Module?.dataFileDownloads || null,
                              runtimeTemplate: !!document.getElementById('eagler-runtime-script-template'),
                              scripts: [...document.scripts].map(script => ({ src: script.src, async: script.async, type: script.type })),
                            })
                            """
                        )
                    )
                except Exception as frame_error:
                    frame_states.append({"url": child_frame.url, "error": str(frame_error)})
            diagnostic = {
                "phase": "first-install",
                "last": last,
                "capabilities": capabilities,
                "consoleErrors": console_errors[-20:],
                "consoleWarnings": console_warnings[-20:],
                "pageErrors": page_errors[-20:],
                "requestFailures": request_failures[-30:],
                "responses": response_diagnostics[-50:],
                "packageUploaded": package_uploaded,
                "packageUploadError": package_upload_error,
                "packageInputEvents": package_input_events,
                "frameStates": frame_states,
            }
            print("Playwright WebKit Launcher: FAIL " + json.dumps(diagnostic, ensure_ascii=False))
            browser.close()
            return 2

        # Second launch must come from the installed Package Store. Prevent the
        # Launcher from silently succeeding by falling back to remote Package
        # descriptor/DATA/music files. Launcher-managed Runtime HTML/JS/WASM
        # remain available as App resources and are intentionally not Package
        # payloads in the converged architecture.
        blocked = []

        def block_remote_package(route, request):
            url = request.url
            lower = url.lower()
            remote_payload = (
                lower.endswith(".package.json")
                or lower.split("?", 1)[0].endswith(f"/{args.game}.data")
                or f"/games/{args.game}/music/" in lower
            )
            if remote_payload:
                blocked.append(url)
                route.abort()
            else:
                route.continue_()

        page.route("**/*", block_remote_package)
        page.evaluate(
            """([game, music]) => {
              localStorage.setItem(`eagler-touhou-game-options-v1-${game}`, JSON.stringify({
                music,
                options: {
                  touchEnabled: true,
                  touchMovementMode: 'touch',
                  touchFocusMode: 'hold-button',
                },
              }));
            }""",
            [args.game, effective_music],
        )
        page.goto(
            args.url
            + ("&" if "?" in args.url else "?")
            + f"test=playwright-webkit-local-{args.game}-{int(time.time())}",
            wait_until="load",
            timeout=30000,
        )
        page.wait_for_function(
            "window.__eaglerBoot?.done === true && !!document.getElementById('launch')",
            timeout=30000,
        )
        page.evaluate(
            """
            () => {
              localStorage.setItem('eagler-touhou-changelog-seen-20260822-1', '1');
              document.querySelector('#changelogDialog')?.close();
              window.__pwFirstFrame = false;
              window.addEventListener('message', event => {
                const m = event.data || {};
                if (m.protocol === 'eagler-touhou/1' && m.event === 'first-frame') {
                  window.__pwFirstFrame = true;
                }
              });
            }
            """
        )
        page.evaluate(
            "(game) => document.querySelector(`[data-game='${game}']`)?.click()",
            args.game,
        )
        page.evaluate(
            """(music) => {
              const select = document.getElementById('musicSelect');
              if (!select) throw new Error('musicSelect missing');
              select.value = music;
              select.dispatchEvent(new Event('change', { bubbles: true }));
            }""",
            effective_music,
        )
        page.evaluate("document.getElementById('launch')?.click()")

        local_deadline = time.time() + 60
        local_last = None
        while time.time() < local_deadline:
            try:
                if page.locator("#decisionDialog").evaluate("d => d.open"):
                    page.locator("#decisionConfirm").click()
            except Exception:
                pass

            local_last = page.evaluate(
                """
                () => ({
                  status: document.getElementById('playerStatus')?.textContent || '',
                  hostStatus: document.getElementById('status')?.textContent || '',
                  startupError: document.getElementById('startupErrorText')?.textContent || '',
                  music: document.getElementById('musicSelect')?.value || '',
                  frameSrc: document.getElementById('gameFrame')?.src || '',
                  firstFrame: window.__pwFirstFrame === true,
                })
                """
            )
            if (
                local_last["firstFrame"]
                and local_last["status"] == "运行中"
                and is_runtime_frame(local_last["frameSrc"], args.game)
                and "managedData=1" in local_last["frameSrc"]
            ):
                local_generation = runtime_generation(local_last["frameSrc"], args.game)
                if local_generation != first_generation:
                    raise RuntimeError(
                        f"local second launch generation changed: {first_generation} -> {local_generation}"
                    )
                runtime = next(
                    (
                        child
                        for child in page.frames
                        if is_runtime_frame(child.url, args.game) and f"gameGeneration={local_generation}" in child.url
                    ),
                    None,
                )
                if runtime is None:
                    raise RuntimeError("ordinary Service Worker Runtime frame missing after local launch")
                managed_data = runtime.evaluate(
                    """
                    (game) => ({
                      provider: typeof Module?.getPreloadedPackage,
                      preload: Module?.preloadResults?.[`${game}.data`] || null,
                      dataPresent: game === 'th07'
                        ? !!FS.analyzePath('/th07.dat').exists
                        : ['/紅魔郷CM.DAT', '/紅魔郷ED.DAT', '/紅魔郷IN.DAT', '/紅魔郷MD.DAT', '/紅魔郷ST.DAT', '/紅魔郷TL.DAT']
                            .every(path => !!FS.analyzePath(path).exists),
                    })
                    """,
                    args.game,
                )
                if managed_data["provider"] != "function" or not managed_data["dataPresent"]:
                    raise RuntimeError(
                        "Emscripten managed DATA preload was not materialized: "
                        + json.dumps(managed_data, ensure_ascii=False)
                    )
                multitouch = page.evaluate(
                    """
                    () => {
                      const surface = document.getElementById('touchDirectSurface');
                      const focus = document.getElementById('touchFocus');
                      const frame = document.getElementById('gameFrame');
                      if (!surface || !focus || !frame) throw new Error('touch regression controls missing');
                      const sr = surface.getBoundingClientRect();
                      const fr = frame.getBoundingClientRect();
                      const br = focus.getBoundingClientRect();
                      const pointer = (target, type, id, x, y, primary = false) => target.dispatchEvent(new PointerEvent(type, {
                        bubbles: true,
                        cancelable: true,
                        pointerId: id,
                        pointerType: 'touch',
                        isPrimary: primary,
                        clientX: x,
                        clientY: y,
                        buttons: type === 'pointerup' ? 0 : 1,
                      }));
                      const moveX = fr.left + fr.width * 0.60;
                      const moveY = fr.top + fr.height * 0.60;
                      pointer(surface, 'pointerdown', 101, moveX, moveY, true);
                      pointer(surface, 'pointermove', 101, moveX + 24, moveY - 12, true);
                      pointer(focus, 'pointerdown', 102, br.left + br.width / 2, br.top + br.height / 2, false);
                      const focusDuring = focus.getAttribute('aria-pressed') === 'true' && focus.classList.contains('is-on');
                      pointer(surface, 'pointermove', 101, moveX + 48, moveY - 18, true);
                      const focusAfterMove = focus.getAttribute('aria-pressed') === 'true' && focus.classList.contains('is-on');
                      pointer(focus, 'pointerup', 102, br.left + br.width / 2, br.top + br.height / 2, false);
                      const focusAfterRelease = focus.getAttribute('aria-pressed') === 'true' || focus.classList.contains('is-on');
                      pointer(surface, 'pointerup', 101, moveX + 48, moveY - 18, true);
                      return {
                        surfaceHidden: surface.hidden,
                        focusHidden: focus.hidden,
                        surfaceWidth: sr.width,
                        focusDuring,
                        focusAfterMove,
                        focusAfterRelease,
                      };
                    }
                    """
                )
                if (
                    multitouch["surfaceHidden"]
                    or multitouch["focusHidden"]
                    or multitouch["surfaceWidth"] <= 0
                    or not multitouch["focusDuring"]
                    or not multitouch["focusAfterMove"]
                    or multitouch["focusAfterRelease"]
                ):
                    raise RuntimeError(
                        "WebKit simultaneous direct-move + hold-focus regression failed: "
                        + json.dumps(multitouch, ensure_ascii=False)
                    )
                result = {
                    "execution": "browserstack-real-ios" if browserstack_enabled else "desktop-playwright-webkit",
                    "device": args.browserstack_device if browserstack_enabled else None,
                    "osVersion": args.browserstack_os_version if browserstack_enabled else None,
                    "game": args.game,
                    "requestedMusic": requested_music,
                    "effectiveMusic": effective_music,
                    "actualMusic": local_last["music"],
                    "audioAvailable": audio_available,
                    "audioCoverage": "tested" if audio_available else (
                        "unavailable-on-real-ios-session"
                        if browserstack_enabled
                        else "unavailable-in-windows-playwright-webkit"
                    ),
                    "firstGeneration": first_generation,
                    "localGeneration": local_generation,
                    "blockedRemotePackageRequests": len(blocked),
                    "managedData": managed_data,
                    "simultaneousMoveFocus": multitouch,
                    "status": local_last["status"],
                    "capabilities": capabilities,
                }
                print("Playwright WebKit Launcher: PASS " + json.dumps(result, ensure_ascii=False))
                browser.close()
                return 0
            time.sleep(0.25)

        diagnostic = {
            "phase": "local-second-launch",
            "firstGeneration": first_generation,
            "last": local_last,
            "blockedRemotePackageRequests": blocked[-20:],
            "capabilities": capabilities,
                "consoleErrors": console_errors[-20:],
                "consoleWarnings": console_warnings[-20:],
                "pageErrors": page_errors[-20:],
                "toastHistory": page.evaluate("window.__pwToastHistory || []"),
                "serviceWorker": page.evaluate(
                    """async () => 'serviceWorker' in navigator ? {
                      controller: !!navigator.serviceWorker.controller,
                      registrations: (await navigator.serviceWorker.getRegistrations()).map(registration => ({
                        scope: registration.scope,
                        active: registration.active?.scriptURL || '',
                        state: registration.active?.state || '',
                      })),
                    } : null"""
                ),
                "indexedDb": page.evaluate(
                    """async () => 'databases' in indexedDB
                      ? (await indexedDB.databases()).map(database => database.name).filter(Boolean)
                      : []"""
                ),
                "requestFailures": request_failures[-30:],
                "responses": response_diagnostics[-50:],
            }
        print("Playwright WebKit Launcher: FAIL " + json.dumps(diagnostic, ensure_ascii=False))
        browser.close()
        return 2


if __name__ == "__main__":
    sys.exit(main())
