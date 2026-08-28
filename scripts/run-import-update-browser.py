import argparse
import json
import os
import time

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("game", choices=["th06", "th07"])
    parser.add_argument("package_zip")
    parser.add_argument("--engine", choices=["chromium", "firefox"], default="chromium")
    args = parser.parse_args()
    package_zip = os.path.abspath(args.package_zip)
    if not os.path.isfile(package_zip):
        raise FileNotFoundError(package_zip)

    with sync_playwright() as playwright:
        browser_type = getattr(playwright, args.engine)
        browser = browser_type.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        page.goto(args.url, wait_until="load", timeout=30_000)
        page.wait_for_function("() => window.__eaglerBoot?.done === true", timeout=30_000)
        page.wait_for_timeout(750)
        page.evaluate("document.querySelector('#changelogDialog')?.close()")
        page.locator(f"[data-game={args.game}]").first.click()
        page.locator("#gamePackageImport").click()
        page.locator("#gameDataImportInput").set_input_files(package_zip)
        # Hosted mode immediately continues into the normal launch/update
        # decision after a successful import. Import-only mode instead returns
        # to the launcher. Accept either product state here.
        try:
            page.wait_for_function("""() =>
              document.getElementById('decisionDialog')?.open === true ||
              document.getElementById('status')?.textContent.includes('游戏包已导入，可以启动游戏')
            """, timeout=120_000)
        except PlaywrightTimeoutError as error:
            diagnostic = page.evaluate("""() => ({
              status: document.getElementById('status')?.textContent,
              playerStatus: document.getElementById('playerStatus')?.textContent,
              toast: document.getElementById('toast')?.textContent,
              decisionOpen: document.getElementById('decisionDialog')?.open,
              importOpen: !document.getElementById('gameDataImportWindow')?.hidden,
              importReason: document.getElementById('gameDataImportReason')?.textContent,
            })""")
            raise AssertionError(f"import did not reach an actionable state: {diagnostic}") from error

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
              return { installation, generation };
            } finally { db.close(); }
          }
        """
        imported = page.evaluate(snapshot_js, args.game)
        descriptor = imported["generation"]["descriptor"]
        if imported["installation"]["source"] != "local" or not descriptor["revision"].endswith("-no-ogg"):
            raise AssertionError(f"content-only import identity was not preserved: {imported}")
        if "runtime" in descriptor or "runtimes" in descriptor or descriptor.get("runtimeRequirement", {}).get("dataFile") != "game-data":
            raise AssertionError("content-only import unexpectedly carries an executable Runtime")
        if any(item.get("source", "").lower().endswith((".html", ".js", ".wasm")) for item in descriptor["files"].values()):
            raise AssertionError("content-only import contains executable Runtime files")

        page.evaluate("""
          const select = document.getElementById('musicSelect');
          select.value = 'none';
          select.dispatchEvent(new Event('change', { bubbles: true }));
          window.__importUpdateFirstFrame = false;
          addEventListener('message', event => {
            const message = event.data || {};
            if (message.protocol === 'eagler-touhou/1' && message.event === 'first-frame') window.__importUpdateFirstFrame = true;
          });
        """)
        if not page.locator("#decisionDialog").evaluate("dialog => dialog.open"):
            page.locator("#launch").click()
            page.wait_for_function("() => document.getElementById('decisionDialog')?.open === true", timeout=30_000)
        prompt_text = page.locator("#decisionMessage").text_content() or ""
        if "新版游戏资源" not in prompt_text or "导入" not in prompt_text:
            raise AssertionError(f"imported content was not associated with remote update: {prompt_text}")
        page.locator("#decisionConfirm").click()
        page.wait_for_function("() => document.getElementById('playerStatus')?.textContent === '运行中' && window.__importUpdateFirstFrame === true", timeout=180_000)

        updated = page.evaluate(snapshot_js, args.game)
        catalog = page.evaluate("fetch('games.json', { cache: 'no-store' }).then(response => response.json())")
        expected_revision = catalog["games"][args.game]["revision"]
        if updated["generation"]["descriptor"]["revision"] != expected_revision:
            raise AssertionError("imported content did not update to the associated remote release")
        if updated["installation"]["source"] != "local":
            raise AssertionError("remote update erased the imported installation provenance")
        frame_url = page.locator("#gameFrame").get_attribute("src") or ""
        if f"/runtime/{args.game}/{args.game}.html" not in frame_url or "managedData=1" not in frame_url:
            raise AssertionError(f"updated import did not use the App-managed Runtime: {frame_url}")

        print(json.dumps({
            "game": args.game,
            "engine": args.engine,
            "importRevision": descriptor["revision"],
            "updatedRevision": expected_revision,
            "sourceAfterUpdate": updated["installation"]["source"],
            "runtime": frame_url,
        }, ensure_ascii=False))
        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
