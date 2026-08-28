import argparse
import json
import os

from playwright.sync_api import sync_playwright


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("game", choices=["th06", "th07"])
    parser.add_argument("package_zip")
    args = parser.parse_args()
    package_zip = os.path.abspath(args.package_zip)
    if not os.path.isfile(package_zip):
        raise FileNotFoundError(package_zip)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        page.goto(args.url, wait_until="load", timeout=30_000)
        page.wait_for_function("() => window.__eaglerBoot?.done === true", timeout=30_000)
        page.wait_for_timeout(750)
        page.evaluate("""() => {
          document.querySelector('#changelogDialog')?.close();
          window.__legacyFirstFrame = false;
          addEventListener('message', event => {
            const message = event.data || {};
            if (message.protocol === 'eagler-touhou/1' && message.event === 'first-frame') window.__legacyFirstFrame = true;
          });
        }""")
        page.locator(f"[data-game={args.game}]").first.click()
        page.evaluate("""() => {
          const select = document.getElementById('musicSelect');
          select.value = 'none';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }""")
        page.locator("#gamePackageImport").click()
        page.locator("#gameDataImportInput").set_input_files(package_zip)
        page.wait_for_function("""() =>
          document.getElementById('playerStatus')?.textContent === '运行中' &&
          window.__legacyFirstFrame === true
        """, timeout=240_000)

        state = page.evaluate("""async game => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('eagler-touhou-package-store-v1');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            const tx = db.transaction(['installations', 'generations'], 'readonly');
            const installation = await new Promise((resolve, reject) => {
              const request = tx.objectStore('installations').get(game);
              request.onsuccess = () => resolve(request.result || null);
              request.onerror = () => reject(request.error);
            });
            const generation = installation?.currentGeneration ? await new Promise((resolve, reject) => {
              const request = tx.objectStore('generations').get([game, installation.currentGeneration]);
              request.onsuccess = () => resolve(request.result || null);
              request.onerror = () => reject(request.error);
            }) : null;
            return { installation, generation };
          } finally { db.close(); }
        }""", args.game)
        descriptor = state["generation"]["descriptor"]
        carries_runtime = "runtime" in descriptor or "runtimes" in descriptor
        if not carries_runtime:
            raise AssertionError("fixture is not a legacy Package that carries executable Runtime files")
        frame_url = page.locator("#gameFrame").get_attribute("src") or ""
        if frame_url.startswith("blob:") or "managedData=1" not in frame_url:
            raise AssertionError(f"legacy Package did not use App-managed Runtime: {frame_url}")
        print(json.dumps({
            "pass": True,
            "game": args.game,
            "legacyRevision": descriptor["revision"],
            "legacyCarriesRuntime": carries_runtime,
            "runtime": frame_url,
            "source": state["installation"]["source"],
        }, ensure_ascii=False))
        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
