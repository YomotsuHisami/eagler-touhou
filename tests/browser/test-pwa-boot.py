"""Real Launcher + production SW, without proprietary games or sibling builds.

The iframe/ESM/WASM fixture is NOT evidence of a Touhou game's first frame,
physical iOS installation, audio resumption, or platform storage persistence.
"""
import argparse
import functools
import json
import os
import socket
import subprocess
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import Error as PlaywrightError, sync_playwright
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]


def browser_options(engine):
    executable = os.environ.get("EAGLER_CHROMIUM_EXECUTABLE") if engine.name == "chromium" else None
    return {"executable_path": executable} if executable else {}


def build(directory, version, environment=None):
    # Production icons are private Host artwork, not frontend source files.
    # Supply synthetic icons before hashing the test site's App Shell.
    manifest = json.loads((ROOT / "public/site.webmanifest").read_text(encoding="utf-8"))
    icons = [(icon["src"], tuple(map(int, icon["sizes"].split("x")))) for icon in manifest["icons"]]
    icons.append(("assets/pwa/apple-touch-icon.png", (180, 180)))
    for name, size in icons:
        target = directory / name
        target.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", size, (16, 16, 15)).save(target)
    result = subprocess.run(
        ["node", "tests/browser/build-pwa-fixture.mjs", str(directory), version],
        cwd=ROOT, text=True, capture_output=True, check=True, timeout=120, env=environment,
    )
    return json.loads(result.stdout.strip().splitlines()[-1])["build"]


class Handler(SimpleHTTPRequestHandler):
    unavailable = False
    drop_connections = False
    runtime_requests = []
    blocked_runtime_prefixes = ()
    request_lock = threading.Lock()
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".mjs": "text/javascript", ".js": "text/javascript",
                      ".wasm": "application/wasm", ".webmanifest": "application/manifest+json"}

    @classmethod
    def runtime_hits(cls, prefix="/runtime/"):
        with cls.request_lock:
            return [path for path in cls.runtime_requests if path.startswith(prefix)]

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if "/runtime/" in path:
            with self.request_lock:
                self.runtime_requests.append(path)
        if self.drop_connections:
            # Real transport failure, no HTTP response and no page/SW routing
            # mock. This is origin unavailability, NOT device airplane mode.
            self.close_connection = True
            try:
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.connection.close()
            return
        if any(path.startswith(prefix) for prefix in self.blocked_runtime_prefixes):
            self.send_error(503, "Unselected Runtime unavailable")
            return
        if self.unavailable:
            self.send_error(503, "Simulated server outage")
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *_args):
        pass


def boot(page, url):
    page.goto(url, wait_until="load", timeout=45000)
    page.wait_for_function("window.__eaglerBoot?.done === true", timeout=30000)
    assert page.locator("#pwaOpen").count() == 0, "retired install/offline controls are still present"
    page.evaluate("document.querySelector('#firstUseNoticeDialog')?.close()")


def wait_async(page, expression, timeout=45000):
    # wait_for_function treats a Promise itself as truthy; it does not poll its
    # resolved boolean. Await each evaluation before deciding to continue.
    # https://github.com/microsoft/playwright/issues/29132
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        if page.evaluate(expression):
            return
        page.wait_for_timeout(100)
    diagnostic = page.evaluate("""async () => ({
        url: location.href, controlled: !!navigator.serviceWorker.controller,
        registrations: (await navigator.serviceWorker.getRegistrations()).map(r => ({
            scope: r.scope, active: r.active?.state, waiting: r.waiting?.state,
            installing: r.installing?.state,
        })),
    })""")
    raise AssertionError(f"SW condition timed out: {expression}; {diagnostic}")


def mark(case):
    print(json.dumps({"case": case, "pass": True}), flush=True)


def status(page):
    return page.evaluate("""async () => {
        const registration = await navigator.serviceWorker.getRegistration('./');
        if (!registration?.active) return null;
        const channel = new MessageChannel();
        return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => { channel.port1.close(); reject(new Error('SW status timeout')); }, 10000);
            channel.port1.onmessage = event => {
                clearTimeout(timer); channel.port1.close(); resolve(event.data);
            };
            registration.active.postMessage({ type: 'GET_APP_SHELL_STATUS' }, [channel.port2]);
        });
    }""")


def launch_fixture(page, origin, version):
    selected = page.evaluate("""async base => {
        const { prepareRuntimeLaunch } = await import(base + 'fixture/launcher/runtime-launch.mjs');
        return await prepareRuntimeLaunch('runtime/pwa-test/runtime.html?runtimeEpoch=1', {baseUrl: base});
    }""", origin)
    assert len(selected["generation"]) == 64
    assert "/" + selected["generation"] + "/" in selected["url"]
    page.evaluate("""url => {
        document.querySelector('#pwaFixtureFrame')?.remove();
        const frame = document.createElement('iframe');
        frame.id = 'pwaFixtureFrame'; frame.src = url; document.body.append(frame);
    }""", selected["url"])
    page.wait_for_function("""version => document.querySelector('#pwaFixtureFrame')?.contentWindow?.fixtureVersion === version""",
                           arg=version, timeout=20000)
    page.locator("#pwaFixtureFrame").evaluate("element => element.remove()")
    return selected


def runtime_file(site, name, group="runtime/pwa-test/"):
    manifest = json.loads((site / 'runtime-manifest.json').read_text(encoding='utf-8'))
    current = next(entry['current'] for entry in manifest['groups'] if entry['root'] == group)
    return site / group / current['generation'] / name


def probe_offline_emulation(engine, origin):
    """An independent literal-response SW distinguishes driver from app faults."""
    browser = engine.launch(headless=True, **browser_options(engine))
    context = browser.new_context()
    page = context.new_page()
    try:
        page.goto(origin + "pwa-probe/")
        page.evaluate("""async () => {
            await navigator.serviceWorker.register('./sw.js');
            await navigator.serviceWorker.ready;
        }""")
        page.goto(origin + "pwa-probe/literal")
        assert page.locator("h1").inner_text() == "Literal worker response"
        assert page.evaluate("!!navigator.serviceWorker.controller")
        context.set_offline(True)
        try:
            page.goto(origin + "pwa-probe/literal", timeout=10000)
        except PlaywrightError as error:
            # Only the specifically reproduced upstream driver failure permits
            # alternate fault injection. Any application failure remains fatal.
            if engine.name != "webkit" or "WebKit encountered an internal error" not in str(error):
                raise
            print(json.dumps({"probe": "literal-service-worker-offline-emulation",
                              "supported": False, "error": str(error),
                              "upstream": "https://github.com/microsoft/playwright/issues/42775"}), flush=True)
            return False
        assert page.locator("h1").inner_text() == "Literal worker response"
        print(json.dumps({"probe": "literal-service-worker-offline-emulation", "supported": True}), flush=True)
        return True
    finally:
        context.close()
        browser.close()


def assert_network_unavailable(page, origin):
    # An unknown pathname is deliberately not handled by either worker.
    failed = page.evaluate("""async url => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try { await fetch(url, { cache: 'no-store', signal: controller.signal }); return false; }
        catch { return true; }
        finally { clearTimeout(timer); }
    }""", origin + "network-required-negative-control")
    assert failed, "negative control reached the network during the outage"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--browser", choices=["chromium", "webkit", "firefox"], required=True)
    args = parser.parse_args()
    target = os.environ.get("EAGLER_PWA_TEST_TARGET", "main")
    if target not in ("main", "react"):
        parser.error("EAGLER_PWA_TEST_TARGET must be main or react")
    with tempfile.TemporaryDirectory(prefix="eagler-pwa-") as temporary:
        work = Path(temporary)
        site = work / "site"
        server = None
        fixture_environment = None
        if target == "react":
            # Reserve the original ephemeral loopback server before compiling
            # exact-origin metadata. Serving still starts at the original point.
            server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(site)))
            fixture_environment = {**os.environ,
                                   "EAGLER_PWA_TEST_ORIGIN": f"http://127.0.0.1:{server.server_port}",
                                   "EAGLER_PWA_TEST_SITE_ROOT": str(site)}
        try:
            build_a = build(site, "a", fixture_environment)
            build(site / "nested", "a", fixture_environment)
            probe = site / "pwa-probe"
            probe.mkdir()
            (probe / "index.html").write_text("<!doctype html><title>Independent SW probe</title>", encoding="utf-8")
            (probe / "sw.js").write_text("""self.addEventListener('fetch', event => {
            if (new URL(event.request.url).pathname.endsWith('/literal'))
                event.respondWith(new Response('<!doctype html><h1>Literal worker response</h1>',
                    { headers: { 'Content-Type': 'text/html' } }));
        });""", encoding="utf-8")
            with Handler.request_lock:
                Handler.runtime_requests.clear()
        except BaseException:
            if server is not None:
                server.server_close()
            raise
        server = server or ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(site)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = f"http://127.0.0.1:{server.server_port}/"
        errors = []
        try:
            with sync_playwright() as playwright:
                engine = getattr(playwright, args.browser)
                emulation_supported = probe_offline_emulation(engine, origin)
                outage_mode = "browser-offline-plus-origin-drop" if emulation_supported else "origin-connection-drop"

                def set_outage(context, enabled):
                    # Cover the worker's network process as well as page fetches.
                    Handler.drop_connections = enabled
                    if emulation_supported:
                        context.set_offline(enabled)

                print(json.dumps({"browser": args.browser, "outage_mode": outage_mode,
                                  "device_airplane_mode_verified": False}), flush=True)
                context = engine.launch_persistent_context(str(work / "profile"), headless=True, **browser_options(engine))
                context.on("page", lambda page: page.on("pageerror", lambda error: errors.append(str(error))))
                page = context.new_page()
                boot(page, origin)
                wait_async(page, """async () => {
                    const r = await navigator.serviceWorker.getRegistration('./');
                    return r?.active?.state === 'activated';
                }""", timeout=45000)
                # No clients.claim(): do not switch a network-loaded module graph.
                assert not page.evaluate("!!navigator.serviceWorker.controller")
                boot(page, origin)
                assert page.evaluate("!!navigator.serviceWorker.controller")
                initial_status = status(page)
                assert initial_status["build"] == build_a, initial_status
                assert initial_status["runtimeGroups"] == [], initial_status
                assert Handler.runtime_hits() == [], "first installation fetched a Runtime"
                mark("initial-install-and-controlled-navigation")
                icons = page.evaluate("""async () => {
                    const manifest = await (await fetch('site.webmanifest')).json();
                    return await Promise.all(manifest.icons.map(async icon => {
                        const image = new Image(); image.src = icon.src; await image.decode();
                        return [image.naturalWidth, image.naturalHeight];
                    }));
                }""")
                assert [192, 192] in icons and [512, 512] in icons
                for path in ["en.html", "?game=th07", "?game=th08", "?game=th10"]:
                    boot(page, origin + path)
                mark("icons-localized-and-query-entries")
                # Simulate optional APIs being restricted in a separate clean profile.
                restricted = engine.launch_persistent_context(str(work / "restricted"), headless=True, **browser_options(engine))
                restricted.add_init_script("""(() => {
                    Object.defineProperty(navigator, 'storage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } });
                    if ('serviceWorker' in navigator) navigator.serviceWorker.register = () => { throw new DOMException('blocked', 'SecurityError'); };
                })();""")
                restricted_page = restricted.new_page()
                restricted_page.on("pageerror", lambda error: errors.append(str(error)))
                boot(restricted_page, origin)
                restricted.close()
                mark("restricted-optional-APIs")

                boot(page, origin)
                assert Handler.runtime_hits() == [], "visiting the Launcher must not prepare games"
                # Cache, but do not launch, the fixture before going offline.
                result = page.evaluate("""async () => {
                    const r = await navigator.serviceWorker.getRegistration('./');
                    const paths = ['runtime.html', 'boot.mjs', 'empty.wasm'].map(p => 'runtime/pwa-test/' + p);
                    const channel = new MessageChannel();
                    return await new Promise((resolve, reject) => {
                        const timer = setTimeout(() => reject(new Error('Runtime cache timeout')), 15000);
                        channel.port1.onmessage = e => { clearTimeout(timer); channel.port1.close(); resolve(e.data); };
                        r.active.postMessage({ type: 'CACHE_APP_SHELL_PATHS', paths }, [channel.port2]);
                    });
                }""")
                assert result["ok"]
                assert status(page)["runtimeGroups"] == ["runtime/pwa-test/"]
                assert Handler.runtime_hits("/runtime/pwa-unused/") == []
                set_outage(context, True)
                boot(page, origin)
                launch_fixture(page, origin, "a")
                assert_network_unavailable(page, origin)
                set_outage(context, False)
                mark("offline-refresh-and-first-iframe-wasm-launch")
                # Establish another SW scope; root cache GC must not delete it.
                nested = context.new_page()
                boot(nested, origin + "nested/")
                wait_async(nested, """async () => (await navigator.serviceWorker.getRegistration('./'))?.active?.state === 'activated'""")
                boot(nested, origin + "nested/")
                nested.close()
                other = context.new_page()
                boot(other, origin)
                other.evaluate("document.querySelector('#decisionDialog').showModal()")
                other.evaluate("window.__oldPageMarker = true")
                before_update = Handler.runtime_hits()
                build_b = build(site, "b", fixture_environment)
                # A broken unselected game cannot block the Launcher update.
                Handler.blocked_runtime_prefixes = ("/runtime/pwa-unused/",)
                page.evaluate("document.querySelector('#decisionDialog').showModal()")
                page.evaluate("async () => (await navigator.serviceWorker.getRegistration('./')).update()")
                wait_async(page, """async () => !!(await navigator.serviceWorker.getRegistration('./'))?.waiting""")
                page.wait_for_function("""() => {
                    const note = document.querySelector('#serverStatusNote');
                    return note?.dataset.kind === 'update' && note.textContent.startsWith('网站更新已下载，正在等待当前操作完成…');
                }""")
                assert status(page)["build"] == build_a
                assert status(other)["build"] == build_a
                assert Handler.runtime_hits() == before_update, "SW update eagerly fetched Runtime bytes"
                # The current page stays on A during its own operation, then
                # activates B while another old page is still open.
                with page.expect_navigation(wait_until="load", timeout=30000):
                    page.evaluate("document.querySelector('#decisionDialog').close()")
                page.wait_for_function("window.__eaglerBoot?.done === true", timeout=30000)
                page.evaluate("document.querySelector('#firstUseNoticeDialog')?.close()")
                assert status(page)["build"] == build_b
                assert page.evaluate("document.querySelector('meta[name=pwa-fixture-shell]')?.content === 'b'")
                assert other.evaluate("window.__oldPageMarker === true && document.querySelector('#decisionDialog').open && document.querySelector('meta[name=pwa-fixture-shell]')?.content === 'a'")
                mark("current-page-auto-activation-with-other-old-page-open")
                assert Handler.runtime_hits() == before_update, "activation eagerly fetched Runtime bytes"
                mark("shell-update-with-broken-unselected-Runtime-fetches-no-Runtimes")
                set_outage(context, True)
                boot(page, origin)
                assert status(page)["build"] == build_b
                # B updated only the shell; A is still the complete offline set.
                launch_fixture(page, origin, "a")
                assert status(page)["runtimeGroups"] == ["runtime/pwa-test/"]
                assert_network_unavailable(page, origin)
                mark("new-page-offline-launch-with-other-old-page-open")
                set_outage(context, False)
                launch_fixture(page, origin, "b")  # fetch the selected group's new dependencies now
                assert len(Handler.runtime_hits("/runtime/pwa-test/")) > len(before_update)
                assert Handler.runtime_hits("/runtime/pwa-unused/") == [], "launch fetched another Runtime"
                assert other.evaluate("window.__oldPageMarker === true")
                new_page = context.new_page()
                boot(new_page, origin)
                assert status(new_page)["build"] == build_b
                assert new_page.evaluate("document.querySelector('meta[name=pwa-fixture-shell]')?.content === 'b'")
                launch_fixture(new_page, origin, "b")
                new_page.close()
                other.close()
                mark("new-page-updated-runtime-launch-with-other-old-page-open")
                set_outage(context, True)
                boot(page, origin)
                launch_fixture(page, origin, "b")
                mark("updated-runtime-and-new-dependency-offline")
                boot(page, origin + "nested/")
                mark("nested-scope-cache-survives-root-update")
                set_outage(context, False)
                boot(page, origin)
                # A corrupt SHELL must fail installation. Runtime failures belong
                # to on-demand selection and are exercised by runtime-recovery.
                build(site, "c", fixture_environment)
                (site / "index.html").write_text("<!doctype html><title>corrupt shell</title>\n", encoding="utf-8")
                page.evaluate("""async () => {
                    window.__candidateFailed = false;
                    const r = await navigator.serviceWorker.getRegistration('./');
                    const watch = () => {
                        const w = r.installing;
                        if (w) w.addEventListener('statechange', () => { if (w.state === 'redundant') window.__candidateFailed = true; });
                    };
                    r.addEventListener('updatefound', watch); watch(); await r.update();
                }""")
                page.wait_for_function("window.__candidateFailed === true", timeout=45000)
                assert status(page)["build"] == build_b
                mark("corrupt-candidate-retains-previous-version")
                Handler.unavailable = True
                boot(page, origin)  # navigator is online but the entire server returns 503
                launch_fixture(page, origin, "b")
                mark("server-503-offline-fallback")
                context.close()
                # Persistent profile, fresh browser process, no reachable server.
                Handler.drop_connections = True
                cold = engine.launch_persistent_context(str(work / "profile"), headless=True, **browser_options(engine))
                set_outage(cold, True)
                cold_page = cold.new_page()
                cold_page.on("pageerror", lambda error: errors.append(str(error)))
                boot(cold_page, origin)
                launch_fixture(cold_page, origin, "b")
                assert_network_unavailable(cold_page, origin)
                assert Handler.runtime_hits("/runtime/pwa-unused/") == []
                assert Handler.runtime_hits("/nested/runtime/") == []
                cold.close()
                mark("fresh-browser-process-offline-launch")
                assert not errors, json.dumps(errors, ensure_ascii=False)
                print(json.dumps({"browser": args.browser, "pass": True, "outage_mode": outage_mode,
                                  "coverage": "real Launcher + production SW + synthetic iframe/ESM/WASM; not real games or physical iOS"}))
        finally:
            Handler.blocked_runtime_prefixes = ()
            Handler.unavailable = False
            Handler.drop_connections = False
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    main()
