import argparse
import json
import os
import sys
import tempfile
import time
from urllib.parse import parse_qs, urlparse
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from support.runtime_document_observation import install_runtime_document_observation


def is_runtime_frame(frame_src: str, game: str) -> bool:
    path = urlparse(frame_src or "").path
    runtime_names = {f"{game}.html"}
    return any(
        path.endswith(f"/runtime/{game}/{name}")
        or path.endswith(f"/games/{game}/{name}")
        for name in runtime_names
    )


def runtime_generation(frame_src: str, game: str) -> str:
    parsed = urlparse(frame_src or "")
    if not is_runtime_frame(frame_src, game):
        return ""
    return parse_qs(parsed.query).get("gameGeneration", [""])[0]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url", nargs="?", default="http://127.0.0.1:8136/")
    parser.add_argument("game", nargs="?", default="th07")
    parser.add_argument("music", nargs="?", default="none")
    parser.add_argument("--package-zip")
    parser.add_argument("--block-game-data", action="store_true")
    parser.add_argument("--artifact-dir")
    args = parser.parse_args()

    if not args.game.startswith("th") or len(args.game) != 4:
        raise SystemExit("invalid game id")
    if args.music not in {"midi", "ogg-stream", "ogg-full", "none"}:
        raise SystemExit("invalid music mode")

    console_errors = []
    console_warnings = []
    page_errors = []
    request_failures = []
    response_diagnostics = []

    with sync_playwright() as p:
        browser = p.webkit.launch(headless=True)
        # This exercises the mobile/touch WebKit code path on Windows. It is
        # deliberately not presented as real iOS/Safari hardware coverage.
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
        install_runtime_document_observation(page)
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
                args.artifact_dir
                or os.path.join(tempfile.gettempdir(), "eagler-playwright-webkit-diagnostics")
            )
            os.makedirs(artifact_dir, exist_ok=True)
            screenshot_path = os.path.join(
                artifact_dir, f"webkit-mobile-{args.game}-launcher-boot-failure.png"
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
              localStorage.setItem('eagler-touhou-first-use-notice-seen-v1', '1');
              document.querySelector('#firstUseNoticeDialog')?.close();
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
        page.evaluate("document.querySelector('#firstUseNoticeDialog')?.close()")

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
                # Some WebKit automation bridges can assign the FileList
                # without emitting the DOM change event that starts the
                # Launcher's importer. Emit it only when the page proves no
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

        deadline = time.time() + 120
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
                  frameSrc: globalThis.__originalRuntimeDocumentObservation ? globalThis.__originalRuntimeDocumentObservation.url(document.getElementById('gameFrame')) : document.getElementById('gameFrame')?.src || '',
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
                musicPreferenceExplicit: true,
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
              localStorage.setItem('eagler-touhou-first-use-notice-seen-v1', '1');
              document.querySelector('#firstUseNoticeDialog')?.close();
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
                  frameSrc: globalThis.__originalRuntimeDocumentObservation ? globalThis.__originalRuntimeDocumentObservation.url(document.getElementById('gameFrame')) : document.getElementById('gameFrame')?.src || '',
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
                      provider: game === 'th08'
                        ? typeof window.parent?.__eaglerPrepareManagedRuntimeDataV1
                        : typeof Module?.getPreloadedPackage,
                      preload: game === 'th08'
                        ? null
                        : Module?.preloadResults?.[`${game}.data`] || null,
                      dataPresent: game === 'th08'
                        ? Array.isArray(Module?.th08RetailFiles)
                          && Module.th08RetailFiles.length === 2
                          && typeof Module?._th08_web_allocate_game_data === 'function'
                          && typeof Module?._th08_web_set_retail_file_sizes === 'function'
                        : game === 'th07'
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

                runtime.evaluate(
                    """
                    () => {
                      globalThis.__eaglerDirectTouchProbe = [];
                      if (globalThis.__eaglerDirectTouchProbeInstalled) return;
                      globalThis.__eaglerDirectTouchProbeInstalled = true;
                      addEventListener('message', event => {
                        const message = event.data;
                        if (message?.protocol !== 'eagler-touhou/1' || message?.command !== 'direct-touch') return;
                        globalThis.__eaglerDirectTouchProbe.push({
                          type: message.type,
                          id: message.id,
                          x: message.x,
                          y: message.y,
                        });
                      });
                    }
                    """
                )
                simultaneous_move_focus = page.evaluate(
                    """
                    () => {
                      const surface = document.getElementById('touchDirectSurface');
                      const focus = document.getElementById('touchFocus');
                      const frame = document.getElementById('gameFrame');
                      if (!surface || !focus || !frame) throw new Error('touch regression controls missing');
                      const fr = frame.getBoundingClientRect();
                      const br = focus.getBoundingClientRect();
                      const list = touches => ({
                        length: touches.length,
                        item: index => touches[index] ?? null,
                      });
                      const contact = (target, identifier, clientX, clientY) => ({
                        target, identifier, clientX, clientY,
                      });
                      const dispatch = (target, type, touches) => {
                        const event = new Event(type, { bubbles: true, cancelable: true });
                        Object.defineProperty(event, 'changedTouches', { value: list(touches) });
                        target.dispatchEvent(event);
                        return event.defaultPrevented;
                      };
                      const moveX = fr.left + fr.width * 0.60;
                      const moveY = fr.top + fr.height * 0.60;
                      const focusX = br.left + br.width / 2;
                      const focusY = br.top + br.height / 2;
                      let frameFocusCalls = 0;
                      Object.defineProperty(frame, 'focus', {
                        configurable: true,
                        value: () => { frameFocusCalls++; },
                      });
                      const prevented = [];
                      try {
                        prevented.push(dispatch(surface, 'touchstart', [contact(surface, 101, moveX, moveY)]));
                        prevented.push(dispatch(surface, 'touchmove', [contact(surface, 101, moveX + 24, moveY - 12)]));
                        prevented.push(dispatch(focus, 'touchstart', [contact(focus, 102, focusX, focusY)]));
                        const focusDuring = focus.getAttribute('aria-pressed') === 'true' && focus.classList.contains('is-on');
                        prevented.push(dispatch(surface, 'touchmove', [contact(surface, 101, moveX + 48, moveY - 18)]));
                        const focusAfterMove = focus.getAttribute('aria-pressed') === 'true' && focus.classList.contains('is-on');
                        prevented.push(dispatch(focus, 'touchend', [contact(focus, 102, focusX, focusY)]));
                        const focusAfterRelease = focus.getAttribute('aria-pressed') === 'true' || focus.classList.contains('is-on');
                        prevented.push(dispatch(surface, 'touchmove', [contact(surface, 101, moveX + 72, moveY - 24)]));
                        prevented.push(dispatch(surface, 'touchend', [contact(surface, 101, moveX + 72, moveY - 24)]));
                        return {
                          surfaceHidden: surface.hidden,
                          focusHidden: focus.hidden,
                          surfaceWidth: surface.getBoundingClientRect().width,
                          focusDuring,
                          focusAfterMove,
                          focusAfterRelease,
                          frameFocusCalls,
                          prevented,
                        };
                      } finally {
                        delete frame.focus;
                      }
                    }
                    """
                )
                page.wait_for_timeout(80)
                simultaneous_move_focus_messages = runtime.evaluate(
                    """() => globalThis.__eaglerDirectTouchProbe?.slice() || []"""
                )
                simultaneous_move_focus_types = [entry.get("type") for entry in simultaneous_move_focus_messages]
                if (
                    simultaneous_move_focus["surfaceHidden"]
                    or simultaneous_move_focus["focusHidden"]
                    or simultaneous_move_focus["surfaceWidth"] <= 0
                    or not simultaneous_move_focus["focusDuring"]
                    or not simultaneous_move_focus["focusAfterMove"]
                    or simultaneous_move_focus["focusAfterRelease"]
                    or simultaneous_move_focus["frameFocusCalls"] != 0
                    or not all(simultaneous_move_focus["prevented"])
                    or simultaneous_move_focus_types != ["down", "move", "move", "move", "up"]
                ):
                    raise RuntimeError(
                        "iOS direct-move + hold-focus ownership regression failed: "
                        + json.dumps(
                            {
                                "ui": simultaneous_move_focus,
                                "messages": simultaneous_move_focus_messages,
                            },
                            ensure_ascii=False,
                        )
                    )

                runtime.evaluate("() => { globalThis.__eaglerDirectTouchProbe = []; }")
                tap_point = page.evaluate(
                    """
                    () => {
                      const frame = document.getElementById('gameFrame');
                      const rect = frame.getBoundingClientRect();
                      return { x: rect.left + rect.width * 0.62, y: rect.top + rect.height * 0.58 };
                    }
                    """
                )
                page.touchscreen.tap(tap_point["x"], tap_point["y"])
                page.wait_for_timeout(120)
                page.touchscreen.tap(tap_point["x"], tap_point["y"])
                page.wait_for_timeout(120)
                direct_tap_probe = runtime.evaluate(
                    """() => globalThis.__eaglerDirectTouchProbe?.slice() || []"""
                )
                direct_tap_types = [entry.get("type") for entry in direct_tap_probe]
                if direct_tap_types[-4:] != ["down", "up", "down", "up"]:
                    raise RuntimeError(
                        "WebKit consecutive direct-touch taps did not reach Runtime: "
                        + json.dumps(direct_tap_probe, ensure_ascii=False)
                    )
                post_release_frames = None
                if args.game == "th08":
                    # iOS/WebKit can transiently drop canvas focus as the last
                    # finger is released.  Exercise that exact lifecycle after
                    # all synthetic touches are up: losing DOM/canvas focus
                    # must not stop the Web presentation loop.
                    before_release_blur = runtime.evaluate(
                        """() => ({
                          frames: Module._th08_web_get_presentation_frame_count?.() ?? -1,
                          callbacks: Module._th08_web_get_callback_count?.() ?? -1,
                          documentFocus: document.hasFocus(),
                          activeTag: document.activeElement?.tagName || '',
                        })"""
                    )
                    runtime.evaluate(
                        """() => {
                          Module.canvas?.focus?.({ preventScroll: true });
                          Module.canvas?.blur?.();
                        }"""
                    )
                    page.wait_for_timeout(900)
                    after_release_blur = runtime.evaluate(
                        """() => ({
                          frames: Module._th08_web_get_presentation_frame_count?.() ?? -1,
                          callbacks: Module._th08_web_get_callback_count?.() ?? -1,
                          documentFocus: document.hasFocus(),
                          activeTag: document.activeElement?.tagName || '',
                        })"""
                    )
                    post_release_frames = {
                        "before": before_release_blur,
                        "after": after_release_blur,
                        "frameDelta": after_release_blur["frames"] - before_release_blur["frames"],
                        "callbackDelta": after_release_blur["callbacks"] - before_release_blur["callbacks"],
                    }
                    if post_release_frames["frameDelta"] <= 0 or post_release_frames["callbackDelta"] <= 0:
                        raise RuntimeError(
                            "TH08 WebKit post-touch focus-loss froze presentation: "
                            + json.dumps(post_release_frames, ensure_ascii=False)
                        )
                result = {
                    "execution": "desktop-playwright-webkit-mobile-emulation",
                    "game": args.game,
                    "requestedMusic": requested_music,
                    "effectiveMusic": effective_music,
                    "actualMusic": local_last["music"],
                    "audioAvailable": audio_available,
                    "audioCoverage": "tested" if audio_available else "unavailable-in-windows-playwright-webkit",
                    "firstGeneration": first_generation,
                    "localGeneration": local_generation,
                    "blockedRemotePackageRequests": len(blocked),
                    "managedData": managed_data,
                    "simultaneousMoveFocus": {
                        "ui": simultaneous_move_focus,
                        "messages": simultaneous_move_focus_messages,
                    },
                    "directTouchTaps": direct_tap_probe,
                    "postReleaseFrames": post_release_frames,
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
