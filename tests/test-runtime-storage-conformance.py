"""L4 Runtime Storage conformance, using the real Launcher and compiled Runtimes.

Preconditions: explicit legal score fixtures; current source served at --url;
installed Python Playwright engines; Runtime/DATA available to that Launcher.
Mutations: fresh browser contexts only; import fixture, sync, reload, export;
command case adds/removes a flat probe; nested case is separate and opt-in.
Invariant: exact user bytes survive restore and temporary Runtime teardown.
Proves: named game/browser lifecycle and host storage commands.
Does NOT prove: gameplay unlock semantics, Replay, crash durability, real iOS.
"""

import argparse
import hashlib
import json
import subprocess
import time
import traceback
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
RESTORE_FAILURE_SCRIPT = """expectedName => {
  if (location.pathname.split('/').pop() !== expectedName) return;
  let moduleValue;
  Object.defineProperty(globalThis, 'Module', {
    configurable: true,
    get: () => moduleValue,
    set: value => {
      moduleValue = value;
      if (!Array.isArray(value?.preRun) || value.__storageRestoreFailureInstalled) return;
      value.__storageRestoreFailureInstalled = true;
      window.__eaglerStorageRestoreFailureInjected = true;
      value.preRun.unshift(() => {
        const originalSyncfs = FS.syncfs.bind(FS);
        let injected = false;
        FS.syncfs = (populate, callback) => {
          if (populate && !injected) {
            injected = true;
            window.__eaglerStorageRestoreFailureTriggered = true;
            queueMicrotask(() => callback(new Error('injected restore failure')));
            return;
          }
          originalSyncfs(populate, callback);
        };
      });
    },
  });
}"""


def digest(data):
    return hashlib.sha256(data).hexdigest()


def registry():
    result = subprocess.run(
        ["node", "--input-type=module", "-e",
         "import {PRODUCT_GAMES} from './product-catalog.mjs'; console.log(JSON.stringify(PRODUCT_GAMES))"],
        cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8",
    )
    return json.loads(result.stdout)


class StorageCase:
    def __init__(self, page, url, game, storage, out):
        self.page, self.url, self.game, self.storage, self.out = page, url, game, storage, out
        self.events, self.errors, self.console = [], [], []
        self.runtime_errors = []
        page.expose_function("__recordStorageEvent", lambda event: self.runtime_errors.append(event)
                             if event.get("game") == self.game and event.get("event") in ("error", "fatal") else None)
        page.on("pageerror", lambda error: self.errors.append(str(error)))
        page.on("console", lambda message: self.console.append({"type": message.type, "text": message.text}))
        page.add_init_script("""(() => {
          window.__storageEvents = [];
          window.addEventListener('message', event => {
            if (event.source !== document.getElementById('gameFrame')?.contentWindow || event.origin !== location.origin) return;
            const m = event.data || {};
            if (m.protocol === 'eagler-touhou/1' && m.event) {
              const entry = {game:m.game,event:m.event,error:m.error};
              window.__storageEvents.push(entry);
              window.__recordStorageEvent(entry).catch(()=>{});
            }
          });
        })()""")

    def prepare(self):
        self.page.goto(self.url, wait_until="load", timeout=30000)
        self.page.wait_for_function("window.__eaglerBoot?.done === true", timeout=30000)
        self.page.evaluate("""game => {
          localStorage.setItem('eagler-touhou-first-use-notice-seen-v1', '1');
          document.querySelector('#firstUseNoticeDialog')?.close();
          localStorage.setItem(`eagler-touhou-game-options-v1-${game}`, JSON.stringify({music:'none',musicPreferenceExplicit:true,options:{}}));
          document.querySelector(`[data-game='${game}']:not(.game-multiplayer)`).click();
          const music = document.getElementById('musicSelect');
          music.value = 'none'; music.dispatchEvent(new Event('change', {bubbles:true}));
        }""", self.game)

    def launch(self):
        print(f"{self.game}: launch", flush=True)
        already_launched = self.page.evaluate("game => window.__storageEvents.some(e=>e.game===game && e.event==='first-frame') && document.getElementById('player')?.classList.contains('open')", self.game)
        if not already_launched:
            self.page.evaluate("window.__storageEvents = []")
            self.page.locator("#launch").evaluate("e => e.click()")
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            if self.page.locator("#decisionDialog").evaluate("e => e.open"):
                self.page.locator("#decisionConfirm").click()
            state = self.page.evaluate("""game => ({
              events: window.__storageEvents.filter(e=>e.game===game),
              status: document.getElementById('status')?.textContent,
              playerStatus: document.getElementById('playerStatus')?.textContent,
              src: document.getElementById('gameFrame')?.src
            })""", self.game)
            if any(e["event"] in ("error", "fatal") for e in state["events"]):
                raise AssertionError(state)
            if self.errors or any(token in (state["playerStatus"] or "").lower() for token in ["not supplied", "failed", "失败", "错误"]):
                raise AssertionError({"state": state, "pageErrors": self.errors})
            if any(e["event"] == "first-frame" for e in state["events"]):
                self.events.append({"launch": state})
                return
            self.page.wait_for_timeout(100)
        raise TimeoutError(state)

    def command(self, command, **payload):
        return self.page.evaluate("""async ({game,command,payload}) => {
          const frame = document.getElementById('gameFrame');
          const target = frame.contentWindow;
          const epoch = Number(new URL(frame.src, location.href).searchParams.get('runtimeEpoch'));
          if (!Number.isSafeInteger(epoch) || epoch <= 0) throw Error('Runtime navigation epoch missing');
          const request = `storage-conformance-${crypto.randomUUID()}`;
          return await new Promise((resolve,reject) => {
            const timer=setTimeout(()=>{window.removeEventListener('message', receive);reject(Error(`${command} timeout`));},10000);
            function receive(event) {
              const m=event.data || {};
              if(event.source!==target || event.origin!==location.origin || m.protocol!=='eagler-touhou/1' || m.game!==game || m.epoch!==epoch || m.request!==request) return;
              clearTimeout(timer);window.removeEventListener('message',receive);
              if(!m.ok) reject(Error(m.error || command));
              else resolve(m.bytes ? {...m,bytes:Array.from(new Uint8Array(m.bytes))} : m);
            }
            window.addEventListener('message',receive);
            target.postMessage({protocol:'eagler-touhou/1',game,epoch,command,request,...payload},location.origin);
          });
        }""", {"game": self.game, "command": command, "payload": payload})

    def read(self, name):
        return bytes(self.command("read", path=name)["bytes"])

    def close(self):
        self.page.evaluate("window.dispatchEvent(new PopStateEvent('popstate'))")
        self.page.wait_for_function("!document.getElementById('player')?.classList.contains('open') && !document.getElementById('gameFrame')?.hasAttribute('src')", timeout=15000)

    def import_score(self, fixture):
        # Slot selection must happen outside gameplay. Import is staged in the
        # slot library and applied/verified by the Runtime on the next launch.
        self.close()
        self.page.locator("#scoreFilesOpen").click()
        self.page.wait_for_function("document.getElementById('scoreFilesDialog')?.open")
        with self.page.expect_file_chooser(timeout=10000) as chooser:
            self.page.locator(".score-save-library-header button").click()
        chooser.value.set_files(str(fixture))
        row = self.page.locator(".score-save-row").filter(
            has=self.page.get_by_text(fixture.name, exact=True)
        )
        row.wait_for(state="visible", timeout=15000)
        row.locator(".score-save-select").click()
        self.page.wait_for_function("""name => [...document.querySelectorAll('.score-save-select')].some(
            el => el.querySelector('strong')?.textContent === name && el.getAttribute('aria-pressed') === 'true'
        )""", arg=fixture.name, timeout=15000)
        self.page.locator("#scoreFilesClose").click()
        # Preserve the original durable-byte assertion after a real Runtime
        # write/sync/verify, not immediately after merely choosing a pending slot.
        self.launch()
        assert self.read(self.storage["scoreFile"]) == fixture.read_bytes(), "selected slot reaches Runtime"
        self.close()

    def export_score(self):
        self.page.locator("#scoreFilesOpen").click()
        selected = self.page.locator(".score-save-row").filter(
            has=self.page.locator('.score-save-select[aria-pressed="true"]')
        )
        selected.wait_for(state="visible", timeout=15000)
        with self.page.expect_download(timeout=60000) as download:
            selected.locator(".score-save-download").click()
        destination = self.out / "exported-score.dat"
        download.value.save_as(str(destination))
        self.page.locator("#scoreFilesClose").click()
        self.page.wait_for_function("!document.getElementById('gameFrame')?.hasAttribute('src')", timeout=15000)
        return destination.read_bytes()

    def persisted_score(self):
        return bytes(self.page.evaluate("""async ({saveRoot,scoreFile}) => {
          const db=await new Promise((resolve,reject)=>{
            const r=indexedDB.open(saveRoot);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
          });
          try {
            return await new Promise((resolve,reject)=>{
              const tx=db.transaction('FILE_DATA','readonly');
              const r=tx.objectStore('FILE_DATA').get(`${saveRoot}/${scoreFile}`);
              r.onsuccess=()=>resolve(Array.from(r.result?.contents || []));r.onerror=()=>reject(r.error);
            });
          } finally {db.close();}
        }""", self.storage))

    def wait_persisted_score(self, expected, timeout_ms=5000):
        deadline = time.monotonic() + timeout_ms / 1000
        observed = b""
        while time.monotonic() < deadline:
            observed = self.persisted_score()
            if observed == expected:
                return
            self.page.wait_for_timeout(50)
        raise AssertionError({
            "expectedBytes": len(expected), "expectedSha256": digest(expected),
            "observedBytes": len(observed), "observedSha256": digest(observed),
        })

    def run_restore_failure(self):
        self.prepare()
        self.page.evaluate("window.__storageEvents = []")
        self.page.locator("#launch").evaluate("e => e.click()")
        self.page.wait_for_function(
            "game => window.__storageEvents.some(e => e.game === game && ['error', 'first-frame'].includes(e.event))",
            arg=self.game, timeout=30000,
        )
        events = self.page.evaluate(
            "game => window.__storageEvents.filter(e => e.game === game)", self.game
        )
        frame_state = self.page.locator("#gameFrame").evaluate(
            "frame => ({url: frame.contentWindow.location.href, injected: frame.contentWindow.__eaglerStorageRestoreFailureInjected === true, triggered: frame.contentWindow.__eaglerStorageRestoreFailureTriggered === true})"
        )
        assert frame_state["injected"] and frame_state["triggered"], {"events": events, "frame": frame_state}
        assert any("injected restore failure" in (event.get("error") or "") for event in events), events
        assert not any(event.get("event") in ("ready", "first-frame") for event in events), events
        return {"events": [{"restoreFailure": events}]}

    def run(self, fixture, mode, package=None):
        expected = fixture.read_bytes()
        assert expected, "fixture must be nonempty"
        score = self.storage["scoreFile"]
        self.prepare()
        if package:
            print(f"{self.game}: import explicit content package", flush=True)
            self.page.locator("#gamePackageImport").evaluate("e => e.click()")
            self.page.locator("#gameDataImportWindow").wait_for(state="visible")
            self.page.locator("#gameDataImportInput").set_input_files(str(package), timeout=180000)
            self.page.wait_for_function("game => document.getElementById('status')?.textContent?.includes('可以启动游戏') || window.__storageEvents.some(e=>e.game===game && e.event==='first-frame')", arg=self.game, timeout=180000)
        self.launch()
        self.import_score(fixture)
        assert self.persisted_score() == expected, "import must be durable before reset/reload"
        self.prepare()
        self.launch()
        assert self.read(score) == expected, "restored bytes must be available on first frame"
        if mode != "score-only":
            probe = "conformance-probe.dat" if mode == "commands" else "probe/nested.dat"
            payload = [0, 1, 127, 128, 255]
            self.command("write", path=probe, bytes=payload)
            assert self.read(probe) == bytes(payload)
            assert any(f["path"] == probe for f in self.command("list")["files"])
            self.command("sync")
            self.close()
            self.prepare()
            self.launch()
            assert self.read(probe) == bytes(payload), "probe restore"
            if mode == "commands":
                self.command("remove", path=probe)
                self.command("sync")
                assert all(f["path"] != probe for f in self.command("list")["files"])
                for invalid in ["../escape", "/escape", "a/../escape", "a\\escape", "", "a//b"]:
                    try:
                        self.command("write", path=invalid, bytes=payload)
                    except Exception as error:
                        assert "invalid path" in str(error), str(error)
                    else:
                        raise AssertionError(f"accepted unsafe path: {invalid!r}")
        self.close()
        assert self.persisted_score() == expected, "normal close persistence"
        self.prepare()
        assert self.export_score() == expected, "temporary export exact bytes"
        self.wait_persisted_score(expected)
        self.prepare()
        self.launch()
        assert self.read(score) == expected, "restore after temporary teardown"
        if mode == "commands":
            assert all(f["path"] != "conformance-probe.dat" for f in self.command("list")["files"]), "remove durability"
        self.close()
        assert not self.errors, self.errors
        assert not self.runtime_errors, self.runtime_errors
        return {"bytes": len(expected), "sha256": digest(expected), "events": self.events}


def main():
    products = registry()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8130/")
    parser.add_argument("--fixture-root", type=Path, required=True, help="explicit directory containing <game>/score.dat")
    parser.add_argument("--package", action="append", default=[], help="optional explicit content input GAME=PATH, imported through Launcher UI")
    parser.add_argument("--games", nargs="+", choices=products, default=list(products))
    parser.add_argument("--browsers", nargs="+", choices=["chromium", "webkit"], default=["chromium", "webkit"])
    parser.add_argument("--cases", nargs="+", choices=["score-only", "commands", "nested-write", "restore-failure"], default=["score-only", "commands"])
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts" / "validation" / "runtime-storage" / time.strftime("%Y%m%d-%H%M%S"))
    args = parser.parse_args()
    packages = {}
    for item in args.package:
        game, separator, value = item.partition("=")
        if not separator or game not in products or not Path(value).is_file():
            parser.error(f"invalid package input: {item}")
        packages[game] = Path(value).resolve()
    fixtures = {g: (args.fixture_root / g / products[g]["storage"]["scoreFile"]).resolve() for g in args.games}
    for fixture in fixtures.values():
        if not fixture.is_file():
            parser.error(f"missing explicit fixture: {fixture}")
    args.output.mkdir(parents=True, exist_ok=False)
    results = []
    with sync_playwright() as p:
        for engine in args.browsers:
            with getattr(p, engine).launch(headless=True) as browser:
                for game in args.games:
                    for mode in args.cases:
                        out = args.output / engine / game / mode
                        out.mkdir(parents=True)
                        with browser.new_context(accept_downloads=True, locale="zh-CN") as context:
                            if mode == "restore-failure":
                                runtime_name = products[game]["runtime"].split("?", 1)[0].rsplit("/", 1)[-1]
                                context.add_init_script(f"({RESTORE_FAILURE_SCRIPT})({json.dumps(runtime_name)})")
                            case = StorageCase(context.new_page(), args.url, game, products[game]["storage"], out)
                            fixture_bytes = fixtures[game].read_bytes()
                            record = {"game":game,"browser":engine,"browserVersion":browser.version,"case":mode,"level":"L4","url":args.url,
                                      "fixture":str(fixtures[game]),"bytes":len(fixture_bytes),"sha256":digest(fixture_bytes)}
                            try:
                                if game in packages:
                                    record["package"] = {"path":str(packages[game]),"sha256":digest(packages[game].read_bytes())}
                                if mode == "restore-failure":
                                    record.update(case.run_restore_failure())
                                else:
                                    record.update(case.run(fixtures[game], mode, packages.get(game)))
                                record["status"] = "PASS"
                            except Exception:
                                record.update(status="FAIL", error=traceback.format_exc())
                                try:
                                    case.page.screenshot(path=str(out / "failure.png"), timeout=10000)
                                except Exception as error:
                                    record["screenshotError"] = str(error)
                            record["pageErrors"] = case.errors
                            record["runtimeErrors"] = case.runtime_errors
                            record["console"] = case.console
                            results.append(record)
                            (args.output / "report.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
                            print(f"{engine}/{game}/{mode}: {record['status']}", flush=True)
                            if record["status"] == "FAIL":
                                print(record["error"], flush=True)
    raise SystemExit(1 if any(r["status"] != "PASS" for r in results) else 0)


if __name__ == "__main__":
    main()
