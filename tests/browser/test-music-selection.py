import json
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright


PROJECT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / "tests"))
from support.launcher_target import launcher_server_command

_adapter_contracts = json.loads(subprocess.run(
    ["node", "scripts/inspect-adapter-contract.mjs"],
    cwd=PROJECT,
    check=True,
    capture_output=True,
    text=True,
).stdout)
PRODUCT_FIXTURES = [
    {
        "game": report["game"],
        "dataTarget": report["product"]["dataTarget"],
        "oggMount": report["product"]["music"]["mounts"]["ogg"],
        "multiplayer": report["product"]["multiplayer"] is not None,
    }
    for report in _adapter_contracts
]
SINGLE_GAMES = [item["game"] for item in PRODUCT_FIXTURES]
MULTIPLAYER_GAMES = [item["game"] for item in PRODUCT_FIXTURES if item["multiplayer"]]


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_for_server(url: str, process: subprocess.Popen[str]) -> None:
    deadline = time.monotonic() + 30
    last_error = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"development server exited early with code {process.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except Exception as error:  # startup readiness only
            last_error = error
        time.sleep(0.1)
    raise RuntimeError(f"development server did not become ready: {last_error}")


SEED_LOCAL_OGG = """
async () => {
  const fixtures = __PRODUCT_FIXTURES__;
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('eagler-touhou-package-store-v1');
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ['objects', 'generations', 'installations', 'leases']) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['objects', 'generations', 'installations'], 'readwrite');
      for (const fixture of fixtures) {
        const { game, dataTarget, oggMount } = fixture;
        const musicMount = oggMount.endsWith('/') ? oggMount.slice(0, -1) : oggMount;
        const objectIds = {
          data: `obj-local-${game}-data-0001`,
          ogg1: `obj-local-${game}-ogg-0001`,
          ogg2: `obj-local-${game}-ogg-0002`,
        };
        const objects = tx.objectStore('objects');
        objects.put({ data: new Uint8Array([1]).buffer, type: 'application/octet-stream', bytes: 1 }, objectIds.data);
        objects.put({ data: new Uint8Array([2]).buffer, type: 'audio/ogg', bytes: 1 }, objectIds.ogg1);
        objects.put({ data: new Uint8Array([3]).buffer, type: 'audio/ogg', bytes: 1 }, objectIds.ogg2);
        const generation = {
          id: `${game}-music-regression-generation`,
          game,
          descriptor: {
            schema: 'eagler-touhou/package/1',
            game,
            revision: `${game}-local-music-regression`,
            runtimeRequirement: {
              protocol: 'eagler-touhou/runtime-release/1',
              target: game,
              dataFile: 'game-data',
            },
            base: { files: ['game-data'] },
            components: { ogg: { type: 'ogg', files: ['ogg-1', 'ogg-2'] } },
            files: {
              'game-data': {
                source: `data/${game}.data`, target: dataTarget, revision: 'data-r1', bytes: 1,
              },
              'ogg-1': {
                source: `ogg/${game}_01.ogg`, target: `${musicMount}/${game}_01.ogg`, revision: 'ogg-r1',
              },
              'ogg-2': {
                source: `ogg/${game}_02.ogg`, target: `${musicMount}/${game}_02.ogg`, revision: 'ogg-r1', bytes: 1,
              },
            },
          },
          files: {
            'game-data': { objectId: objectIds.data, revision: 'data-r1', storageMode: 'arraybuffer' },
            'ogg-1': { objectId: objectIds.ogg1, revision: 'ogg-r1', storageMode: 'arraybuffer' },
            'ogg-2': { objectId: objectIds.ogg2, revision: 'ogg-r1', storageMode: 'arraybuffer' },
          },
        };
        tx.objectStore('generations').put(generation, [game, generation.id]);
        tx.objectStore('installations').put({
          game,
          source: 'local',
          currentGeneration: generation.id,
          pendingGeneration: null,
        }, game);
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
"""
SEED_LOCAL_OGG = SEED_LOCAL_OGG.replace("__PRODUCT_FIXTURES__", json.dumps(PRODUCT_FIXTURES))


RUNTIME_PROTOCOL_STUB = r"""<!doctype html>
<meta charset="utf-8">
<script>
(() => {
  const protocol = "eagler-touhou/1";
  const game = location.pathname.match(/runtime-stub\/(th\d+)\.html/)?.[1] || "";
  const epoch = Number(new URLSearchParams(location.search).get("runtimeEpoch"));
  window.__eaglerTestMessages = [];
  window.__eaglerTestWrites = [];
  const FS = {
    mkdirTree(path) {},
    writeFile(path, data) {
      window.__eaglerTestWrites.push({ path, bytes: Array.from(data) });
    },
  };
  window.FS = FS;
  window.Module = { FS, touhouMusicMode: "midi" };
  window.addEventListener("message", event => {
    const message = event.data || {};
    if (event.origin !== location.origin || message.protocol !== protocol || message.game !== game || message.epoch !== epoch) return;
    window.__eaglerTestMessages.push(message);
    event.source.postMessage({ protocol, game, epoch, request: message.request, ok: true }, event.origin);
  });
  window.parent.postMessage({ protocol, game, epoch, event: "ready" }, location.origin);
})();
</script>
"""


CORRUPT_LOCAL_OGG = """
async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('eagler-touhou-package-store-v1');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('objects', 'readwrite');
      tx.objectStore('objects').put(
        { data: new ArrayBuffer(0), type: 'audio/ogg', bytes: 0 },
        'obj-local-th06-ogg-0001',
      );
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
"""


def main() -> int:
    port = free_port()
    origin = f"http://127.0.0.1:{port}"
    process = subprocess.Popen(
        launcher_server_command(PROJECT, port),
        cwd=PROJECT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        wait_for_server(f"{origin}/", process)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(service_workers="block")
            page = context.new_page()
            page_errors = []
            console_errors = []
            page.on("pageerror", lambda error: page_errors.append(str(error)))
            page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
            fault = {"mode": ""}

            def strip_published_ogg(route):
                response = route.fetch()
                manifest = response.json()
                manifest['shared']['netplayRelay'] = f'ws://127.0.0.1:{port}/netplay'
                if fault['mode']:
                    manifest['shared']['resourceMode'] = 'import'
                    manifest['shared'].pop('vanillaFont', None)
                    manifest['shared'].pop('unicodeFont', None)
                    manifest['shared'].pop('gameDataFallback', None)
                for game_id, game in manifest.get("games", {}).items():
                    music = game.get("music") or {}
                    music.pop("ogg", None)
                    music.pop("wav", None)
                    game["runtime"] = f"runtime-stub/{game_id}.html"
                    if game_id in MULTIPLAYER_GAMES:
                        game['multiplayerRuntime'] = f'runtime-stub/{game_id}.html?multiplayer=1'
                    if fault['mode']:
                        game['offlineCompatibility'] = {
                            'schema': 'eagler-touhou/offline-game-pack/1',
                            'requiredShared': ['/msgothic.ttc', '/unifont.otf'],
                            'runtimeCompatibility': {'protocol': 'eagler-touhou/1',
                                'dataLayout': game['gameData']['layout'], 'versionSource': 'offline-pack'},
                            'languages': {'source': 'offline-pack', 'baseline': ['ja']},
                        }
                if fault['mode']:
                    subprocess.run(['node', '--input-type=module', '-e',
                        "import {validateHostManifest} from './lib/contracts/host-manifest.mjs';import {readFileSync} from 'node:fs';validateHostManifest(JSON.parse(readFileSync(0,'utf8')));"],
                        input=json.dumps(manifest), text=True, cwd=PROJECT, check=True)
                headers = {
                    key: value for key, value in response.headers.items()
                    if key.lower() not in {"content-length", "content-encoding"}
                }
                headers["content-type"] = "application/json; charset=utf-8"
                route.fulfill(
                    status=response.status,
                    headers=headers,
                    body=json.dumps(manifest),
                )

            page.route("**/host-manifest.json", strip_published_ogg)
            page.route("**/release-catalog.json", lambda route: route.fulfill(status=404, body="not published in this test"))
            def runtime_stub(route):
                stub = RUNTIME_PROTOCOL_STUB
                if fault['mode'] == 'configure':
                    stub = stub.replace('request: message.request, ok: true',
                        'request: message.request, ok: message.command !== "configure", error: "HTTP 503 music configuration failed"')
                if fault['mode'] == 'missing-data':
                    stub = stub.replace('window.parent.postMessage({ protocol, game, epoch, event: "ready" }, location.origin);', '''
                      window.parent.__eaglerPrepareManagedRuntimeDataV1({
                        game, generation: new URLSearchParams(location.search).get('gameGeneration'), epoch,
                      }).then(() => window.parent.postMessage({ protocol, game, epoch, event: "ready" }, location.origin))
                        .catch(error => { window.__providerError = error.message; });
                    ''')
                route.fulfill(status=200, content_type='text/html', body=stub)
            page.route("**/runtime-stub/*.html*", runtime_stub)
            page.goto(f"{origin}/", wait_until="load", timeout=30_000)
            try:
                page.wait_for_function("() => window.__eaglerBoot?.done === true", timeout=30_000)
            except Exception as error:
                diagnostic = page.evaluate("""() => ({
                  boot: window.__eaglerBoot || null,
                  readyState: document.readyState,
                  body: (document.body?.innerText || '').slice(0, 1800),
                  appScript: document.querySelector('script[type="module"]')?.src || '',
                })""")
                server_stdout = ""
                server_stderr = ""
                if process.poll() is not None:
                    server_stdout = process.stdout.read() if process.stdout else ""
                    server_stderr = process.stderr.read() if process.stderr else ""
                raise AssertionError(json.dumps({
                    "diagnostic": diagnostic,
                    "pageErrors": page_errors,
                    "consoleErrors": console_errors,
                    "serverStdout": server_stdout,
                    "serverStderr": server_stderr,
                }, ensure_ascii=False)) from error
            page.evaluate(SEED_LOCAL_OGG)
            page.reload(wait_until="load")
            try:
                page.wait_for_function("() => window.__eaglerBoot?.done === true", timeout=30_000)
            except Exception as error:
                diagnostic = page.evaluate("""() => ({
                  boot: window.__eaglerBoot || null,
                  readyState: document.readyState,
                  body: (document.body?.innerText || '').slice(0, 1800),
                })""")
                raise AssertionError(json.dumps({
                    "phase": "reload-after-package-seed",
                    "diagnostic": diagnostic,
                    "pageErrors": page_errors,
                    "consoleErrors": console_errors,
                }, ensure_ascii=False)) from error
            page.evaluate("document.querySelector('#firstUseNoticeDialog')?.close()")

            results = {}

            def exercise(card_selector: str, select_id: str, desired: str, require_single_music_panel: bool = False):
                page.locator(card_selector).click()
                if require_single_music_panel:
                    page.wait_for_function("() => !document.getElementById('musicOption').hidden")
                result = page.evaluate("""([selectId, desired]) => {
                  const select = document.getElementById(selectId);
                  const enabled = Object.fromEntries([...select.options].map(option => [option.value, !option.disabled]));
                  select.value = desired;
                  select.dispatchEvent(new Event('change', { bubbles: true }));
                  return { enabled, value: select.value };
                }""", [select_id, desired])
                page.wait_for_timeout(50)
                result["valueAfterRender"] = page.locator(f"#{select_id}").input_value()
                return result

            for game in SINGLE_GAMES:
                results[game] = exercise(
                    f'.game[data-game="{game}"]:not(.game-multiplayer)', "musicSelect", "ogg-full", True
                )
            for game in MULTIPLAYER_GAMES:
                product = f"{game}mp"
                results[product] = exercise(f'[data-product="{product}"]', "mpMusicSelect", "ogg-stream")

            for result in results.values():
                if not result["enabled"].get("ogg-stream") or not result["enabled"].get("ogg-full"):
                    raise AssertionError(f"local OGG options are disabled: {result}")
                if not result["valueAfterRender"].startswith("ogg-"):
                    raise AssertionError(f"render reverted explicit local OGG selection: {result}")

            page.locator('.game-th06:not(.game-multiplayer)').click()
            page.wait_for_function("() => !document.getElementById('musicOption').hidden")
            page.select_option("#musicSelect", "ogg-full")
            page.locator("#launch").click()
            page.wait_for_function(
                "document.querySelector('#gameFrame')?.contentWindow?.__eaglerTestMessages?.some(message => message.command === 'launch')",
                timeout=30_000,
            )
            runtime_result = page.locator("#gameFrame").evaluate("""frame => {
              const runtime = frame.contentWindow;
              return {
                configure: runtime.__eaglerTestMessages.find(message => message.command === 'configure'),
                writes: runtime.__eaglerTestWrites,
                musicMode: runtime.Module.touhouMusicMode,
              };
            }""")
            if runtime_result["configure"]["music"] != "midi":
                raise AssertionError(f"local OGG must configure the Runtime barrier as MIDI first: {runtime_result}")
            if runtime_result["musicMode"] != "ogg":
                raise AssertionError(f"local OGG did not become the active Runtime mode: {runtime_result}")
            if runtime_result["writes"] != [
                {"path": "/bgm/th06_01.ogg", "bytes": [2]},
                {"path": "/bgm/th06_02.ogg", "bytes": [3]},
            ]:
                raise AssertionError(f"local OGG Package objects were not installed into the Runtime FS: {runtime_result}")

            page.goto(f"{origin}/", wait_until="load", timeout=30_000)
            page.wait_for_function("() => window.__eaglerBoot?.done === true", timeout=30_000)
            page.evaluate(CORRUPT_LOCAL_OGG)
            page.reload(wait_until="load")
            page.wait_for_function("() => window.__eaglerBoot?.done === true", timeout=30_000)
            page.evaluate("document.querySelector('#firstUseNoticeDialog')?.close()")
            page.locator('.game-th06:not(.game-multiplayer)').click()
            page.select_option("#musicSelect", "ogg-full")
            page.locator("#launch").click()
            page.wait_for_function(
                "document.querySelector('#gameFrame')?.contentWindow?.__eaglerTestMessages?.some(message => message.command === 'launch')",
                timeout=30_000,
            )
            fallback_result = page.locator("#gameFrame").evaluate("""frame => ({
              musicMode: frame.contentWindow.Module.touhouMusicMode,
              writes: frame.contentWindow.__eaglerTestWrites,
            })""")
            fallback_result["selectedMode"] = page.locator("#musicSelect").input_value()
            fallback_result["toast"] = page.locator("#toast").inner_text()
            if fallback_result["musicMode"] != "midi" or fallback_result["selectedMode"] != "midi":
                raise AssertionError(f"corrupt local OGG did not produce one coherent MIDI fallback: {fallback_result}")
            if "本次改用 MIDI" not in fallback_result["toast"]:
                raise AssertionError(f"local OGG fallback was not explained to the user: {fallback_result}")

            page.goto(f'{origin}/', wait_until='load')
            page.wait_for_function('window.__eaglerBoot?.done === true')
            page.evaluate(SEED_LOCAL_OGG)
            page.evaluate('''async () => {
              const db = await new Promise((resolve, reject) => {
                const request = indexedDB.open('eagler-touhou-package-store-v1');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              });
              try { await new Promise((resolve, reject) => {
                const tx = db.transaction('generations', 'readwrite');
                const store = tx.objectStore('generations');
                const key = ['th06', 'th06-music-regression-generation'];
                const request = store.get(key);
                request.onsuccess = () => {
                  const generation = request.result;
                  generation.descriptor.components.ogg.files.push('ogg-3');
                  generation.descriptor.files['ogg-3'] = {
                    source: 'ogg/th06_03.ogg', target: '/bgm/th06_03.ogg', revision: 'ogg-r1', bytes: 1,
                  };
                  generation.files['ogg-3'] = {objectId: 'missing-remaining-ogg', revision: 'ogg-r1'};
                  store.put(generation, key);
                };
                tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
              }); } finally { db.close(); }
            }''')
            page.reload(wait_until='load')
            page.wait_for_function('window.__eaglerBoot?.done === true')
            page.evaluate("document.querySelector('#firstUseNoticeDialog')?.close()")
            page.locator('.game-th06:not(.game-multiplayer)').click()
            page.select_option('#musicSelect', 'ogg-stream')
            page.locator('#launch').click()
            page.wait_for_function("document.querySelector('#gameFrame')?.contentWindow?.__eaglerTestMessages?.some(m=>m.command === 'launch')")
            page.wait_for_function("document.querySelector('#toast').textContent.includes('th06_03.ogg') && document.querySelector('#transfer').hidden", timeout=10000)

            # Exercise the real import-mode launcher catches with a Runtime
            # protocol stub. Music/Runtime HTTP errors must not replace DATA.
            fault['mode'] = 'configure'
            for multiplayer in (False, True):
                page.goto(f'{origin}/', wait_until='load')
                page.wait_for_function('window.__eaglerBoot?.done === true')
                page.wait_for_function("document.querySelector('#serverStatusNote').textContent.includes('未配置外部游戏包下载链接')")
                page.evaluate("document.querySelector('#firstUseNoticeDialog')?.close()")
                if multiplayer:
                    page.locator('[data-product="th06mp"]').click()
                    assert not page.locator('#mpShell').evaluate('el=>el.hidden'), page.locator('#toast').inner_text()
                    page.locator('#mpReplayViewer').click()
                else:
                    page.locator('.game-th06:not(.game-multiplayer)').click()
                    page.locator('#launch').click()
                page.wait_for_function("!document.querySelector('#startupError').hidden", timeout=10000)
                assert 'HTTP 503 music configuration failed' in page.locator('#startupErrorText').inner_text()
                assert page.locator('#gameDataImportWindow').evaluate('el=>el.hidden')
                assert page.locator('#transfer').evaluate('el=>el.hidden')

            fault['mode'] = 'missing-data'
            page.goto(f'{origin}/', wait_until='load')
            page.wait_for_function('window.__eaglerBoot?.done === true')
            page.wait_for_function("document.querySelector('#serverStatusNote').textContent.includes('未配置外部游戏包下载链接')")
            page.evaluate("document.querySelector('#firstUseNoticeDialog')?.close()")
            await_delete_data = '''async () => {
              const db = await new Promise((resolve, reject) => {
                const request = indexedDB.open('eagler-touhou-package-store-v1');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              });
              try { await new Promise((resolve, reject) => {
                const tx = db.transaction('objects', 'readwrite');
                tx.objectStore('objects').delete('obj-local-th06-data-0001');
                tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
              }); } finally { db.close(); }
            }'''
            page.evaluate(await_delete_data)
            page.locator('.game-th06:not(.game-multiplayer)').click()
            page.locator('#launch').click()
            page.wait_for_function("!document.querySelector('#gameDataImportWindow').hidden", timeout=10000)
            assert page.locator('#transfer').evaluate('el=>el.hidden')

            print(json.dumps({
                "musicSelectionBrowser": "PASS",
                "hostPublishesOgg": False,
                "runtimeLaunch": runtime_result,
                "corruptLocalFallback": fallback_result,
                "importModeRuntimeFailure": "normal and multiplayer preserve the actual error",
                "missingDataProvider": "recovery shown within 10 seconds",
                "missingRemainingOgg": "launch succeeds and transfer closes",
                "products": results,
            }, ensure_ascii=False))
            browser.close()
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
