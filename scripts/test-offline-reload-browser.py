import argparse
import json

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("game", choices=["th06", "th07"])
    args = parser.parse_args()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        def arm_first_frame():
            page.evaluate("""() => {
              window.__offlineFirstFrame = false;
              addEventListener('message', event => {
                const message = event.data || {};
                if (message.protocol === 'eagler-touhou/1' && message.event === 'first-frame') window.__offlineFirstFrame = true;
              });
            }""")

        def select_and_launch():
            page.locator(f"[data-game={args.game}]").first.click()
            page.evaluate("""() => {
              const select = document.getElementById('musicSelect');
              select.value = 'none';
              select.dispatchEvent(new Event('change', { bubbles: true }));
            }""")
            page.locator("#launch").click()
            try:
                page.wait_for_function("""() =>
                  document.getElementById('playerStatus')?.textContent === '运行中' &&
                  window.__offlineFirstFrame === true
                """, timeout=45_000)
            except PlaywrightTimeoutError as error:
                diagnostic = page.evaluate("""() => ({
                  status: document.getElementById('status')?.textContent || '',
                  playerStatus: document.getElementById('playerStatus')?.textContent || '',
                  toast: document.getElementById('toast')?.textContent || '',
                  frame: document.getElementById('gameFrame')?.getAttribute('src') || '',
                  online: navigator.onLine,
                })""")
                raise AssertionError(f"launch did not reach offline first-frame: {diagnostic}") from error

        page.goto(args.url, wait_until="load", timeout=30_000)
        page.wait_for_function("() => window.__eaglerBoot?.done === true", timeout=30_000)
        # A fresh profile installs and claims the App Shell worker. Let that
        # handoff finish, then establish one stable controlled document before
        # measuring game installation/first-frame behavior.
        page.evaluate("() => navigator.serviceWorker.ready")
        page.wait_for_timeout(500)
        page.reload(wait_until="load", timeout=30_000)
        page.wait_for_function("() => window.__eaglerBoot?.done === true", timeout=30_000)
        page.wait_for_timeout(750)
        page.evaluate("document.querySelector('#changelogDialog')?.close()")
        # Install the published Package without launching a Runtime. This keeps
        # the online preparation phase free of App Shell reload/first-frame
        # timing, and makes the first actual Runtime launch happen offline.
        online = page.evaluate("""async game => {
          const catalogUrl = new URL('games.json', location.href).href;
          const catalog = await fetch(catalogUrl, { cache: 'no-store' }).then(r => {
            if (!r.ok) throw new Error(`games.json HTTP ${r.status}`);
            return r.json();
          });
          const { installPublishedPackage } = await import('./package-launcher.mjs');
          const installed = await installPublishedPackage(game, {
            catalog,
            catalogUrl,
            addComponents: [],
            fetchImpl: fetch,
          });
          await navigator.serviceWorker.ready;
          const runtimePath = game === 'th07' ? 'runtime/th07/th07.html' : 'runtime/th06/th06.html';
          const runtimeUrl = new URL(runtimePath, location.href).href;
          const cachedRuntime = !!(await caches.match(runtimeUrl));
          const db = await new Promise((resolve, reject) => {
            const r = indexedDB.open('eagler-touhou-package-store-v1');
            r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
          });
          try {
            const installation = await new Promise((resolve, reject) => {
              const r = db.transaction(['installations'], 'readonly').objectStore('installations').get(game);
              r.onsuccess = () => resolve(r.result || null); r.onerror = () => reject(r.error);
            });
            return {
              cachedRuntime,
              currentGeneration: installation?.currentGeneration || null,
              installedGeneration: installed?.installation?.currentGeneration || null,
            };
          } finally { db.close(); }
        }""", args.game)
        if (not online["cachedRuntime"] or not online["currentGeneration"] or
                online["currentGeneration"] != online["installedGeneration"]):
            raise AssertionError(f"online preparation incomplete: {online}")

        context.set_offline(True)
        page.reload(wait_until="load", timeout=30_000)
        page.wait_for_function("() => window.__eaglerBoot?.done === true", timeout=30_000)
        arm_first_frame()
        select_and_launch()

        frame_url = page.locator("#gameFrame").get_attribute("src") or ""
        if frame_url.startswith("blob:") or "managedData=1" not in frame_url:
            raise AssertionError(f"offline restart did not use App-managed Runtime: {frame_url}")
        offline_state = page.evaluate("""() => ({
          status: document.getElementById('playerStatus')?.textContent || '',
          server: document.getElementById('serverStatusNote')?.textContent || '',
          online: navigator.onLine,
        })""")
        if offline_state["online"] is not False:
            raise AssertionError(f"browser was not actually offline: {offline_state}")
        print(json.dumps({
            "pass": True,
            "game": args.game,
            "generation": online["currentGeneration"],
            "runtime": frame_url,
            "offline": offline_state,
        }, ensure_ascii=False))
        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
