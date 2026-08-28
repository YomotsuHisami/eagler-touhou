import argparse
import json
import re
import time

from playwright.sync_api import sync_playwright


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("game", choices=["th06", "th07"])
    parser.add_argument("--engine", choices=["chromium", "firefox"], default="chromium")
    args = parser.parse_args()
    mount = "/bgm" if args.game == "th06" else "/bgm-ogg"
    requested_ogg = []

    with sync_playwright() as playwright:
        browser_type = getattr(playwright, args.engine)
        launch_options = {"headless": True}
        if args.engine == "chromium": launch_options["args"] = ["--autoplay-policy=no-user-gesture-required"]
        browser = browser_type.launch(**launch_options)
        context = browser.new_context()
        page = context.new_page()

        def route_request(route):
            url = route.request.url
            match = re.search(rf"/{args.game}/music/ogg/([^/?]+\.ogg)", url, re.I)
            if match:
                requested_ogg.append(match.group(1))
                number = re.search(r"_(\d+)", match.group(1))
                if number and int(number.group(1)) >= 3:
                    time.sleep(0.35)
            route.continue_()

        page.route("**/*", route_request)
        page.goto(args.url, wait_until="load", timeout=30_000)
        page.wait_for_function("() => window.__eaglerBoot?.done === true", timeout=30_000)
        page.evaluate("""
          localStorage.setItem('eagler-touhou-changelog-seen-20260822-1', '1');
          document.querySelector('#changelogDialog')?.close();
          window.__oggFirstFrame = false;
          addEventListener('message', event => {
            const message = event.data || {};
            if (message.protocol === 'eagler-touhou/1' && message.event === 'first-frame') window.__oggFirstFrame = true;
          });
        """)
        page.wait_for_timeout(750)
        page.evaluate("document.querySelector('#changelogDialog')?.close()")
        page.locator(f"[data-game={args.game}]").first.click()
        page.evaluate("""
          const select = document.getElementById('musicSelect');
          select.value = 'ogg-stream';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        """)
        page.locator("#launch").click()
        page.wait_for_timeout(100)
        if page.locator("#decisionDialog").evaluate("element => element.open"):
            page.locator("#decisionConfirm").click()

        page.wait_for_function("""
          () => document.getElementById('playerStatus')?.textContent === '运行中' && window.__oggFirstFrame === true
        """, timeout=180_000)

        snapshot_js = """
          async game => {
            const db = await new Promise((resolve, reject) => {
              const request = indexedDB.open('eagler-touhou-package-store-v1');
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            try {
              const installation = await new Promise((resolve, reject) => {
                const request = db.transaction(['installations'], 'readonly').objectStore('installations').get(game);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              });
              const generation = await new Promise((resolve, reject) => {
                const request = db.transaction(['generations'], 'readonly').objectStore('generations').get([game, installation.currentGeneration]);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              });
              const ids = generation.descriptor.components.ogg.files;
              return {
                generationId: generation.id,
                count: ids.filter(id => !!generation.files[id]?.objectId).length,
                total: ids.length,
                names: ids.map(id => generation.descriptor.files[id].target.split('/').at(-1)),
              };
            } finally { db.close(); }
          }
        """
        initial = page.evaluate(snapshot_js, args.game)
        if initial["count"] != 2:
            raise AssertionError(f"launch barrier installed {initial['count']} OGG files instead of exactly 2")

        deadline = time.time() + 60
        third = initial
        while time.time() < deadline:
            third = page.evaluate(snapshot_js, args.game)
            if third["count"] >= 3:
                break
            page.wait_for_timeout(50)
        if third["count"] < 3:
            raise AssertionError("third OGG did not complete persistence")
        runtime = next(frame for frame in page.frames if f"/runtime/{args.game}/{args.game}.html" in frame.url)
        third_path = f"{mount}/{third['names'][2]}"
        runtime.wait_for_function("path => !!FS.analyzePath(path).exists", arg=third_path, timeout=10_000)
        third_ready = True

        deadline = time.time() + 180
        complete = third
        while time.time() < deadline:
            complete = page.evaluate(snapshot_js, args.game)
            if complete["count"] == complete["total"]:
                break
            page.wait_for_timeout(100)
        if complete["count"] != complete["total"]:
            raise AssertionError(f"OGG background persistence stopped at {complete}")
        last_name = complete["names"][-1]
        runtime.wait_for_function("path => !!FS.analyzePath(path).exists", arg=f"{mount}/{last_name}", timeout=10_000)
        last_ready = True
        if len(requested_ogg) != complete["total"] or len(set(requested_ogg)) != complete["total"]:
            raise AssertionError(f"OGG requests were not one complete request per file: {requested_ogg}")

        save_root = "/savesth06" if args.game == "th06" else "/savesth07"
        marker_paths = [
            f"{save_root}/codex-save-domain.dat",
            f"{save_root}/codex-config-domain.cfg",
            f"{save_root}/replay/codex-replay-domain.rpy",
        ]
        runtime.evaluate("""
          async paths => {
            FS.mkdirTree(paths[2].slice(0, paths[2].lastIndexOf('/')));
            paths.forEach((path, index) => FS.writeFile(path, new Uint8Array([82, 84, 68, index + 1])));
            await new Promise((resolve, reject) => FS.syncfs(false, error => error ? reject(error) : resolve()));
          }
        """, marker_paths)
        updated_generation = page.evaluate("""
          async game => {
            const catalogUrl = new URL('games.json', location.href).href;
            const catalog = await fetch(catalogUrl, { cache: 'no-store' }).then(response => response.json());
            const launcher = await import('./package-launcher.mjs');
            const result = await launcher.installPublishedPackage(game, {
              catalog,
              catalogUrl,
              addFileIds: [],
              preserveLocalSource: true,
              fetchImpl: fetch,
            });
            return result.generation.id;
          }
        """, args.game)
        if updated_generation == complete["generationId"]:
            raise AssertionError("content update did not create a new immutable generation")

        page.close()
        page = context.new_page()
        page.route("**/*", route_request)
        page.goto(args.url, wait_until="load", timeout=30_000)
        page.wait_for_function("() => window.__eaglerBoot?.done === true", timeout=30_000)
        page.wait_for_timeout(750)
        page.evaluate("document.querySelector('#changelogDialog')?.close(); window.__oggFirstFrame = false; addEventListener('message', event => { const message = event.data || {}; if (message.protocol === 'eagler-touhou/1' && message.event === 'first-frame') window.__oggFirstFrame = true; });")
        page.locator(f"[data-game={args.game}]").first.click()
        page.evaluate("""
          const select = document.getElementById('musicSelect');
          select.value = 'none';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        """)
        page.locator("#launch").click()
        deadline = time.time() + 180
        reloaded_runtime = None
        while time.time() < deadline:
            reloaded_runtime = next((frame for frame in page.frames if f"/runtime/{args.game}/{args.game}.html" in frame.url), None)
            running = page.evaluate("document.getElementById('playerStatus')?.textContent === '运行中' && window.__oggFirstFrame === true")
            if reloaded_runtime is not None and running:
                break
            page.wait_for_timeout(100)
        if reloaded_runtime is None:
            status = page.evaluate("""
              ({
                status: document.getElementById('playerStatus')?.textContent,
                hostStatus: document.getElementById('status')?.textContent,
                error: document.getElementById('startupErrorText')?.textContent,
                frameSrc: document.getElementById('gameFrame')?.src,
                playerOpen: document.getElementById('player')?.classList.contains('open'),
                transfer: document.getElementById('transferLabel')?.textContent,
                decisionOpen: document.getElementById('decisionDialog')?.open,
                firstFrame: window.__oggFirstFrame,
                boot: window.__eaglerBoot,
              })
            """)
            raise AssertionError(f"reloaded Runtime frame missing: {[frame.url for frame in page.frames]} {status}")
        markers = reloaded_runtime.evaluate("""
          paths => paths.map(path => Array.from(FS.readFile(path)))
        """, marker_paths)
        if markers != [[82, 84, 68, 1], [82, 84, 68, 2], [82, 84, 68, 3]]:
            raise AssertionError(f"IDBFS user-data domains did not survive reload: {markers}")
        after_reload = page.evaluate(snapshot_js, args.game)
        if after_reload["generationId"] != updated_generation:
            raise AssertionError("user-data reload changed the selected immutable content generation")

        print(json.dumps({
            "game": args.game,
            "engine": args.engine,
            "launchBarrier": initial["count"],
            "complete": complete["count"],
            "thirdRuntimeReady": third_ready,
            "lastRuntimeReady": last_ready,
            "contentGenerationChanged": complete["generationId"] != updated_generation,
            "userDataAfterReload": ["save", "config", "replay"],
            "requests": requested_ogg,
        }, ensure_ascii=False))
        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
