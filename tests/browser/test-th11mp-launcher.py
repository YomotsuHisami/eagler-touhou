"""Real main Launcher + production TH11 MP + shared Relay + prepared retail DATA.

This gate uses the public product card, multiplayer directory, room controls and
native Replay menu. It never substitutes a Host Manifest, Runtime or DATA. The
declared resources are fetched from the real HTTP server and hash checked before
launch; every browser subsequently uses that server without request interception.

Example (run after the production package is rebuilt and frozen):
  python tests/browser/test-th11mp-launcher.py --package-dir PATH --expected-wasm SHA256 \
    --players 3 --route relay --spectator --restart --disconnect --replay --output REPORT.json

--prepare-only checks resident resources without claiming a gameplay pass.
--startup-only diagnoses resource delivery and measured start without claiming
the complete movement, restart, disconnect, or Replay acceptance.
"""
from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import re
import socket
import subprocess
import threading
import time
import traceback
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlparse

from playwright.sync_api import sync_playwright

PROJECT = Path(__file__).resolve().parents[2]
UINT32_MAX = 4294967295
ROOM_KEY = "eagler-touhou-th11mp-room-v1"
OBSERVE = r"""
(() => {
 if (window !== top) return;
 const gate = window.__th11LauncherGate = {
  events: [], views: [], runs: new Map(), last: null, observerErrors: [],
 };
 let observedModule = null, lastView = '';
 const text = (r, pointer) => {
  const bytes=r.Module.HEAPU8, end=bytes.indexOf(0,pointer);
  return new TextDecoder().decode(bytes.subarray(pointer,end<0?pointer+256:end));
 };
 gate.snapshot = () => {
  const frame=document.querySelector('#gameFrame'), r=frame?.contentWindow;
  if(!r?.core?.th11_mp_status || !r.Module) return null;
  const words=(name,count)=>{
   const p=r.core[name]();
   return Array.from(new Uint32Array(r.Module.HEAPU8.buffer,p,count));
  };
  return {
   epoch:Number(new URL(frame.src).searchParams.get('runtimeEpoch')),
   url:frame.src, active:r.__th11Runtime?.app===1,
   net:words('th11_mp_status',24), game:words('th11_mp_game_status',56),
   calibration:words('th11_mp_calibration_status',32),
   replayUi:words('th11_mp_replay_ui_status',12),
   error:text(r,r.core.th11_mp_error()), route:r.__eaglerPeerTransport?.route||'',
   timing:r.__eaglerNetplayTiming||null, graphics:gate.graphics||null,
   globals:{active:r.__eaglerNetplayLanActive,spectator:r.__eaglerNetplaySpectator,
    path:r.__eaglerNetplayPath,transport:r.__eaglerNetplayTransport,
    failed:r.__eaglerNetplayFailed,error:r.__eaglerNetplayError,
    peersMap:!!r.__eaglerPeerTransport?.peers?.entries},
   fixtureExports:Object.keys(r.core).filter(name=>name.startsWith('mp_fixture_')),
   options:r.Module.eaglerOptions ? {
    netplayMode:r.Module.eaglerOptions.netplayMode,
    netplayPlayer:r.Module.eaglerOptions.netplayPlayer,
    netplayPlayerCount:r.Module.eaglerOptions.netplayPlayerCount,
    netplayAdonisMode:r.Module.eaglerOptions.netplayAdonisMode,
    netplayPredictionLimit:r.Module.eaglerOptions.netplayPredictionLimit,
    netplayInputDelayAuto:r.Module.eaglerOptions.netplayInputDelayAuto,
    netplayChallengeMode:r.Module.eaglerOptions.netplayChallengeMode,
    netplaySpectator:r.Module.eaglerOptions.netplaySpectator,
    replayViewer:r.Module.eaglerOptions.replayViewer,
   } : {},
   legacyPanels:[...r.document.querySelectorAll(
    '#th11-multiplayer-menu,#th11-multiplayer-replay-controls,'+
    '#th11-multiplayer-error,#th11-multiplayer-session-controls')].map(n=>n.id),
  };
 };
 gate.parentState = () => {
  const frame=document.querySelector('#gameFrame'), r=frame?.contentWindow;
  const node=selector=>{
   const n=document.querySelector(selector);
   return n?{hidden:n.hidden,open:n.hasAttribute('open'),
    visible:!!n.getClientRects().length,text:n.innerText?.slice(0,8000)||''}:null;
  };
  const options=r?.Module?.eaglerOptions||{};
  return {at:Date.now(),url:location.href,frameUrl:frame?.src||'',
   frameModule:!!r?.Module,frameCore:!!r?.core,
   frameRuntime:!!r?.__th11Runtime,
   runtimeIdentity:Object.fromEntries(Object.entries(options).filter(([k])=>/session|generation|epoch/i.test(k))),
   decision:node('#decisionDialog'),startupError:node('#startupError'),
   importWindow:node('#gameDataImportWindow'),connection:node('#netplayConnectionWindow'),
   playerClass:document.querySelector('#player')?.className||'',
   roomVisible:!!document.querySelector('#mpRoomView:not([hidden])'),
   room:JSON.parse(sessionStorage.getItem('eagler-touhou-th11mp-room-v1')||'null')};
 };
 const sample=()=>{
  const s=gate.snapshot(); if(!s)return; gate.last=s;
  if(!gate.graphics){
   // The native draw callback has already created its WebGL context. Query
   // that existing context once; do not change attributes, drawing or cadence.
   const c=document.querySelector('#gameFrame').contentWindow.document.querySelector('canvas');
   const gl=c?.getContext('webgl2')||c?.getContext('webgl');
   if(gl){const ext=gl.getExtension('WEBGL_debug_renderer_info');
    gate.graphics={renderer:gl.getParameter(gl.RENDERER),vendor:gl.getParameter(gl.VENDOR),
     unmaskedRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,
     unmaskedVendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):null};}
  }
  s.graphics=gate.graphics||null;
  if(s.net[1] && s.net[3]!==4294967295){
   const key=s.epoch+':'+s.net[12];
   if(!gate.runs.has(key))gate.runs.set(key,new Map());
   const run=gate.runs.get(key); run.set(s.net[3],s);
   if(run.size>6000)run.delete(run.keys().next().value);
   if(s.calibration[1]>0 && s.calibration[1]<5 && s.game[4]>0)
    gate.observerErrors.push('Native world advanced before committed measured frame zero');
  }
 };
 addEventListener('message',e=>{
  const frame=document.querySelector('#gameFrame'),m=e.data;
  if(e.origin!==location.origin || e.source!==frame?.contentWindow ||
     m?.protocol!=='eagler-touhou/1' || m.game!=='th11' || !m.event)return;
  gate.events.push({...m,observedAt:Date.now(),frameUrl:frame.src});
 });
 setInterval(()=>{
  const r=document.querySelector('#gameFrame')?.contentWindow, m=r?.Module;
  if(m && typeof m.onGameFrame==='function' && observedModule!==m){
   observedModule=m;const prior=m.onGameFrame;
   // Read after the original callback; do not stop, pump, seek or mutate native
   // state, input history, calibration or the browser transport.
   m.onGameFrame=(...args)=>{const result=prior(...args);sample();return result;};
  }
  const w=document.querySelector('#netplayConnectionWindow');
  if(w && !w.hidden){
   const v={phase:w.dataset.calibration||'transport',text:w.innerText,
    returnVisible:!!w.querySelector('#netplayConnectionReturn:not([hidden])'),
    width:w.clientWidth,scrollWidth:w.scrollWidth,at:performance.now()};
   const key=v.phase+'|'+v.text;
   if(key!==lastView){gate.views.push(v);lastView=key;}
  }
 },20);
})();
"""
IDENTITY = """() => ({
 member:localStorage.getItem('eagler-touhou-mp-member-v1'),
 client:sessionStorage.getItem('eagler-touhou-th11mp-lobby-client-v1'),
 room:JSON.parse(sessionStorage.getItem('eagler-touhou-th11mp-room-v1')||'null'),
 roomVisible:!!document.querySelector('#mpRoomView:not([hidden])'),
 playerOpen:document.querySelector('#player')?.classList.contains('open')===true,
 me:[...document.querySelectorAll('[data-mp-seat-me]')].filter(n=>!n.hidden).map(n=>n.dataset.mpSeatMe),
})"""


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def process_creation(pid: int):
    """Read creation identity before bounded cleanup of our own browser only."""
    if os.name != "nt":
        try:
            return Path(f"/proc/{pid}/stat").read_text().split(")", 1)[1].split()[19]
        except (FileNotFoundError, IndexError):
            return None
    from ctypes import wintypes
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        return None
    values = [wintypes.FILETIME() for _ in range(4)]
    try:
        if not kernel.GetProcessTimes(handle, *(ctypes.byref(v) for v in values)):
            return None
        return (values[0].dwHighDateTime << 32) | values[0].dwLowDateTime
    finally:
        kernel.CloseHandle(handle)


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_http(url: str, child: subprocess.Popen, timeout: float = 180) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError(f"Server exited with code {child.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=.5) as response:
                if response.status < 400:
                    return
        except Exception:
            time.sleep(.1)
    raise RuntimeError("Server startup timed out: " + url)


def arguments() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--package-dir", type=Path, required=True)
    p.add_argument("--expected-wasm", help="Frozen production SHA256 supplied by the build owner")
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--workspace-root", type=Path)
    p.add_argument("--content-dir", type=Path)
    p.add_argument("--font", type=Path)
    p.add_argument("--unicode-font", type=Path)
    p.add_argument("--import-package", type=Path, help="Real ZIP made by package-server.mjs then package-offline-game.mjs")
    p.add_argument("--url", help="Existing real Launcher origin; omit to start scripts/serve.mjs")
    p.add_argument("--relay-url", help="Existing shared relay; omit to start server/netplay-relay.mjs")
    p.add_argument("--players", type=int, choices=(2, 3), default=2)
    p.add_argument("--route", choices=("rtc", "relay"), default="rtc")
    p.add_argument("--browser-isolation", choices=("process", "context"), default="process",
                   help="Use separate browser processes or one browser with independent participant contexts")
    p.add_argument("--frames", type=int, default=360)
    p.add_argument("--spectator", action="store_true")
    p.add_argument("--challenge", action="store_true", help="Enable the original authoritative room Challenge toggle")
    p.add_argument("--restart", action="store_true")
    p.add_argument("--restart-menu", action="store_true", help="Use the native pause Restart option instead of R")
    p.add_argument("--return-menu", action="store_true", help="Verify native pause Return ends the session and leaves the room")
    p.add_argument("--disconnect", action="store_true")
    p.add_argument("--replay", action="store_true")
    p.add_argument("--prepare-only", action="store_true")
    p.add_argument("--startup-only", action="store_true")
    a = p.parse_args()
    if a.replay and not a.disconnect:
        p.error("--replay needs --disconnect so the standard return button persists and closes this run")
    if a.restart and not a.spectator:
        p.error("--restart requires --spectator to verify admission ends at the old generation")
    if a.restart_menu and not a.restart:
        p.error("--restart-menu requires --restart")
    if a.return_menu and (a.disconnect or a.replay or a.startup_only):
        p.error("--return-menu is a separate terminal flow from disconnect, Replay and startup-only")
    if a.startup_only and (a.restart or a.disconnect or a.replay):
        p.error("--startup-only cannot claim restart, disconnect, or Replay acceptance")
    if not 180 <= a.frames <= 1800:
        p.error("--frames must be 180..1800")
    if not a.prepare_only and not re.fullmatch(r"[a-f0-9]{64}", a.expected_wasm or ""):
        p.error("--expected-wasm must name the final frozen production build")
    return a


def main() -> int:
    a = arguments()
    workspace = (a.workspace_root or Path(os.environ["EAGLER_WORKSPACE_ROOT"])
                 if os.environ.get("EAGLER_WORKSPACE_ROOT") else a.workspace_root)
    if workspace is None:
        workspace = next(parent for parent in PROJECT.parents if (parent / "WORKSPACE.md").is_file())
    workspace = workspace.resolve()
    package = a.package_dir.resolve()
    content = (a.content_dir or workspace / "games/web-content/th11").resolve()
    data_file = content / "th11.data"
    font = (a.font or workspace / "th06-eagler/assets/msgothic.ttc").resolve()
    unicode_font = (a.unicode_font or workspace / "dependencies/unifont-15.1.05/unifont-15.1.05.otf").resolve()
    a.output = a.output.resolve()
    a.output.parent.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
    inventory = json.loads((package / "runtime-files.json").read_text(encoding="utf-8"))
    assert manifest["product"] == "th11mp" and manifest["profile"] == "multiplayer"
    assert inventory["game"] == "th11"
    identities = {}
    for name, expected in inventory["files"].items():
        path = (package / name).resolve()
        assert path.is_relative_to(package), name
        data = path.read_bytes()
        assert len(data) == expected["bytes"] and digest(data) == expected["sha256"], name
        identities[name] = expected
    wasm = identities["th11-sdl.wasm"]["sha256"]
    assert wasm == manifest["execution"]["sha256"]
    if a.expected_wasm:
        assert wasm == a.expected_wasm, ("Stale production package", wasm, a.expected_wasm)
    data_identity = {"path": str(data_file), "bytes": data_file.stat().st_size, "sha256": digest(data_file.read_bytes())}
    for path in (font, unicode_font):
        assert path.is_file(), path
    report = {
        "passed": False, "scope": "real main Launcher, production TH11 MP, shared relay, prepared retail DATA",
        "players": a.players, "route": a.route, "spectator": a.spectator, "restart": a.restart,
        "challenge": a.challenge,
        "expectedWasm": a.expected_wasm, "wasm": wasm, "runtimeManifest": manifest,
        "runtimePackage": str(package), "runtimeInventorySha256": digest((package / "runtime-files.json").read_bytes()),
        "data": data_identity, "font": str(font), "unicodeFont": str(unicode_font),
        "resourceDelivery": "Original Host Manifest URLs and real HTTP server; no browser request interception",
        "startupOnly": a.startup_only, "fullAcceptance": not a.startup_only and not a.prepare_only,
        "errors": [], "console": [], "httpFailures": [], "decisions": [], "screenshots": [],
        "httpVerifiedResources": [], "networkRequests": [], "requestFailures": [],
        "pageLifecycle": [], "runtimeProtocol": {}, "timeline": [],
    }
    if a.import_package:
        a.import_package = a.import_package.resolve()
        with zipfile.ZipFile(a.import_package) as archive:
            descriptor = json.loads(archive.read("package.json"))
            assert descriptor["game"] == "th11"
            imported_data = descriptor["files"]["game-data"]
            assert imported_data["sha256"] == data_identity["sha256"]
            assert imported_data["bytes"] == data_identity["bytes"]
            assert digest(archive.read(imported_data["source"])) == data_identity["sha256"]
        report["importPackage"] = {"path": str(a.import_package), "bytes": a.import_package.stat().st_size,
            "sha256": digest(a.import_package.read_bytes()), "revision": descriptor["revision"],
            "builder": "scripts/package-server.mjs -> scripts/package-offline-game.mjs",
            "music": "none; official package assembled without OGG"}
    if a.prepare_only:
        report["preparationOnly"] = True
        report["gameplayExecuted"] = False
        a.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print("Resident resources verified; no gameplay acceptance was run.")
        return 0

    children: list[subprocess.Popen] = []
    logs = []
    pages = []
    contexts = []
    browsers = []
    browser_processes = {}
    browser = None
    playwright = None
    cached_snapshots = {}
    cached_parent_states = {}
    page_labels = {}
    evidence_frozen = False

    def stamp():
        return {"at": round(time.time() * 1000), "stage": report.get("stage", "preparation")}

    def record_event(category, value):
        target = report.setdefault("cleanupObservations", {}) if evidence_frozen else report
        target.setdefault(category, []).append({**stamp(), **value})

    def trace(message: str) -> None:
        report["stage"] = message
        report["timeline"].append({**stamp(), "message": message})
        print(message, flush=True)
        a.output.with_suffix(".progress.json").write_text(json.dumps({
            "stage": message, "wasm": wasm, "errors": report["errors"],
            "screenshots": report["screenshots"], "httpFailures": report["httpFailures"],
            "observedAt": round(time.time() * 1000), "ownedBrowsers": report.get("ownedBrowsers", []),
        }, ensure_ascii=False, indent=2), encoding="utf-8")

    def screenshot(page, name: str, selector: str | None = None) -> None:
        file = a.output.with_name(a.output.stem + "-" + name + ".png")
        target = page.locator(selector) if selector else page
        target.screenshot(path=str(file), timeout=15000)
        report["screenshots"].append({"name": name, "path": str(file)})

    def native_canvas(page, name: str) -> None:
        file = a.output.with_name(a.output.stem + "-" + name + ".png")
        page.frame_locator("#gameFrame").locator("canvas").screenshot(path=str(file))
        report["screenshots"].append({"name": name, "path": str(file), "surface": "original Runtime canvas"})

    def calibration_report(page):
        # Call only after the original native Pause and after releasing game
        # keys. This existing dialog keeps a stable copy of the actual report.
        page.locator("#netplayCalibrationReport").click()
        page.wait_for_selector("#netplayCalibrationDialog[open]")
        report["standardCalibrationReport"] = json.loads(page.locator("#netplayCalibrationText").input_value())
        screenshot(page, "standard-calibration-report", "#netplayCalibrationDialog")
        page.locator("#netplayCalibrationDialog").get_by_role("button", name=re.compile(r"^(关闭|Close)$")).click()
        page.wait_for_selector("#netplayCalibrationDialog:not([open])", state="attached")

    def dismiss_decisions(page) -> None:
        first = page.locator("#firstUseNoticeDialog[open]")
        if first.count():
            page.locator("#firstUseNoticeClose").click()
        dialog = page.locator("#decisionDialog[open]:not(.closing)")
        if dialog.count():
            message = dialog.inner_text()
            report["decisions"].append(message)
            cancel = dialog.locator("#decisionCancel")
            keep = bool(re.search(r"当前版本|current version", cancel.inner_text(), re.I))
            (cancel if keep else dialog.locator("#decisionConfirm")).click()

    def snapshot(page):
        observed = page.evaluate("""() => {
          const g=window.__th11LauncherGate;
          return {native:g?.snapshot()||g?.last||null,
            parent:g?.parentState?.()||null,events:g?.events||[]};
        }""")
        value = observed["native"]
        cached_snapshots[page] = value
        cached_parent_states[page] = observed["parent"]
        report["runtimeProtocol"][page_labels.get(page, page.url)] = observed["events"]
        return value

    def wait_for(predicate, label: str, timeout=120):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for page in pages:
                if not page.is_closed():
                    dismiss_decisions(page)
            value = predicate()
            if value:
                return value
            if report["errors"]:
                raise AssertionError(report["errors"])
            pages[0].wait_for_timeout(60)
        raise AssertionError(label)

    def key(page, code: str, down: bool | None = None) -> None:
        page.bring_to_front()
        page.frame_locator("#gameFrame").locator("canvas").focus()
        if down is None:
            # A tap means a fresh physical edge. Playwright retains held keys
            # across iframe lifetimes; the shared keyboard owner correctly
            # rejects old autorepeat after a Runtime has been replaced.
            page.keyboard.up(code)
            page.keyboard.press(code, delay=100)
        elif down:
            page.keyboard.down(code)
        else:
            page.keyboard.up(code)

    def menu_tap(page, code: str) -> None:
        # A wall-clock tap can fall between native ticks on a slow renderer.
        # Hold real browser input until confirmed frames have consumed it.
        first = snapshot(page)["net"][3]
        key(page, code, True)
        wait_for(lambda: snapshot(page)["net"][3] >= first + 3, "Native menu key was not captured")
        page.keyboard.up(code)
        release = snapshot(page)["net"][3]
        delay = snapshot(page)["net"][7]
        wait_for(lambda: snapshot(page)["net"][3] >= release + delay + 3, "Native menu key release was not confirmed")

    def check_runtime(s, spectator=False):
        assert s and not s["error"] and not s["globals"].get("failed"), s
        assert s["fixtureExports"] == [] and s["legacyPanels"] == [], s
        assert s["net"][8] == 0, s
        assert bool(s["options"].get("netplayChallengeMode")) == a.challenge, s
        if not spectator:
            assert s["calibration"][1] == 5 and s["calibration"][2] == 129, s
            assert s["calibration"][3] >= 96 and s["calibration"][10] == 0, s
            assert s["options"]["netplayAdonisMode"] == 1 and s["options"]["netplayPredictionLimit"] == 0, s
            assert s["options"]["netplayInputDelayAuto"] is True, s
            assert s["route"] == a.route and s["globals"]["peersMap"], s
        else:
            assert s["net"][10] == 1 and s["net"][15] == 0, s
            assert s["route"] == "spectator" and s["globals"]["peersMap"], s

    def history(page, generation=0, replay=False):
        runs = page.evaluate("() => [...__th11LauncherGate.runs].map(([k,v])=>[k,[...v]])")
        result = {}
        for _, entries in runs:
            for frame, s in entries:
                if s["net"][12] == generation and (s["replayUi"][1] == 2) == replay:
                    result[int(frame)] = s
        return result

    def compare(histories, label: str):
        common = sorted(frame for frame in histories[0] if frame >= 60 and all(frame in m for m in histories))
        assert len(common) >= 20, (label, "Too few same-frame observations", len(common))
        for frame in common:
            values = [m[frame] for m in histories]
            assert len({s["game"][1] for s in values}) == 1, (label, frame, values)
            assert all(s["net"][8] == 0 and s["game"][4] == frame for s in values), (label, frame, values)
        return {"framesCompared": len(common), "firstFrame": common[0], "lastFrame": common[-1],
                "checkpoints": [{"frame": f, "hash": histories[0][f]["game"][1]} for f in (common[0], common[len(common)//2], common[-1])]}

    try:
        relay_url = a.relay_url
        if not relay_url:
            relay_port = free_port()
            relay_url = f"ws://127.0.0.1:{relay_port}/"
            env = os.environ.copy()
            env.update(EAGLER_NETPLAY_RELAY_HOST="127.0.0.1", EAGLER_NETPLAY_RELAY_PORT=str(relay_port),
                       EAGLER_NETPLAY_STUN_URLS="")
            log = a.output.with_suffix(".relay.log").open("w", encoding="utf-8")
            logs.append(log)
            children.append(subprocess.Popen(["node", "server/netplay-relay.mjs"], cwd=PROJECT, env=env, stdout=log, stderr=log))
        url = a.url
        if not url:
            port = free_port()
            url = f"http://127.0.0.1:{port}/"
            env = os.environ.copy()
            env.update(EAGLER_WORKSPACE_ROOT=str(workspace), EAGLER_DEVELOPMENT_GAMES="th11",
                       EAGLER_TH11_CONTENT_DIR=str(content), EAGLER_TOUHOU_NETPLAY_RELAY=relay_url,
                       EAGLER_DEVELOPMENT_VANILLA_FONT=str(font), EAGLER_DEVELOPMENT_UNICODE_FONT=str(unicode_font))
            log = a.output.with_suffix(".http.log").open("w", encoding="utf-8")
            logs.append(log)
            http = subprocess.Popen(["node", "scripts/serve.mjs", str(port)], cwd=PROJECT, env=env, stdout=log, stderr=log)
            children.append(http)
            wait_http(url, http)
        report["url"], report["relayUrl"] = url, relay_url
        trace("Real Launcher and shared relay ready at " + url)
        playwright = sync_playwright().start()
        pw = playwright
        browser_args = [
            "--enable-unsafe-swiftshader", "--disable-features=LocalNetworkAccessChecks",
            "--use-gl=angle", "--use-angle=swiftshader",
            "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding"]
        report["browserArgs"] = browser_args
        browser = pw.chromium.launch(headless=True, args=browser_args)
        browsers.append(browser)
        report["browserIsolationMode"] = a.browser_isolation
        report["browserIsolation"] = (
            "One real Chromium browser per participant; independent contexts, storage and native worlds"
            if a.browser_isolation == "process" else
            "One real Chromium browser with an independent BrowserContext, storage and native world per participant")

        def register_browser(owned_browser, label):
            session = owned_browser.new_browser_cdp_session()
            processes = session.send("SystemInfo.getProcessInfo")["processInfo"]
            session.detach()
            pid = int(next(p["id"] for p in processes if p["type"] == "browser"))
            created = process_creation(pid)
            assert created is not None, ("Could not record owned browser creation identity", pid)
            browser_processes[owned_browser] = (pid, created)
            report.setdefault("ownedBrowsers", []).append({"participant": label, "pid": pid, "creationIdentity": created})

        register_browser(browser, "P1" if a.browser_isolation == "process" else "shared")
        seed = browser.new_context(service_workers="block")
        host_manifest = seed.request.get(urljoin(url, "host-manifest.json")).json()
        seed.close()
        game = host_manifest["games"]["th11"]
        assert game.get("multiplayerRuntime"), "main Host Manifest must declare TH11 MP; no test fallback is allowed"
        assert host_manifest["shared"].get("netplayRelay") == relay_url, host_manifest["shared"]
        assert game["gameData"]["bytes"] == data_identity["bytes"]
        assert game["gameData"]["sha256"] == data_identity["sha256"]
        assert game["gameData"].get("source"), "Use a real hosted DATA declaration"
        runtime_base = urljoin(url, game["multiplayerRuntime"]).rsplit("/", 1)[0] + "/"
        runtime_prefix = urlparse(runtime_base).path
        sources = {
            urljoin(url, game["gameData"]["source"]): data_file,
            urljoin(url, host_manifest["shared"]["vanillaFont"]): font,
            urljoin(url, host_manifest["shared"]["unicodeFont"]): unicode_font,
        }
        sources.update({urljoin(runtime_base, name): package / name for name in identities})
        sources[urljoin(runtime_base, "runtime-files.json")] = package / "runtime-files.json"
        report["hostManifest"] = host_manifest
        for resource_url, file in sources.items():
            began = stamp()
            try:
                with urllib.request.urlopen(resource_url, timeout=30) as response:
                    payload = response.read()
                    observed = {**began, "url": resource_url, "responseUrl": response.url,
                        "status": response.status, "file": str(file), "bytes": len(payload),
                        "sha256": digest(payload), "completedAt": round(time.time() * 1000)}
            except urllib.error.HTTPError as error:
                # The official imported Package owns managed DATA and Unicode
                # font bytes. A development source URL may be unavailable while
                # that valid installed generation supplies the Runtime. Keep
                # this separate from mandatory direct HTTP Runtime delivery.
                unavailable = {**began, "url": resource_url, "status": error.code,
                    "file": str(file), "residentSha256": digest(file.read_bytes()),
                    "requiredForDirectRuntime": file.is_relative_to(package),
                    "managedDataImported": bool(a.import_package)}
                report.setdefault("declaredSourceAvailability", []).append(unavailable)
                if file.is_relative_to(package) or (file == data_file and not a.import_package):
                    raise
                continue
            assert observed["status"] == 200 and payload == file.read_bytes(), observed
            report["httpVerifiedResources"].append(observed)
        trace("Verified every production Runtime file and native font through real HTTP; managed DATA verified against the official import")

        def new_page(label: str):
            # Every participant always gets an independent storage context and
            # real native Runtime. The option only changes process ownership.
            participant_browser = browser
            if pages and a.browser_isolation == "process":
                participant_browser = pw.chromium.launch(headless=True, args=browser_args)
            if participant_browser is not browser:
                browsers.append(participant_browser)
                register_browser(participant_browser, label)
            context = participant_browser.new_context(service_workers="block", viewport={"width": 1280, "height": 900})
            contexts.append(context)
            context.add_init_script(OBSERVE)
            if a.route == "relay":
                # Real relay fallback in a browser without WebRTC. No packet,
                # transport state or native status is fabricated.
                context.add_init_script("Object.defineProperty(globalThis,'RTCPeerConnection',{value:undefined,configurable:true})")
            page = context.new_page()
            pages.append(page)
            page_labels[page] = label
            request_records, frame_ids = {}, {}
            browser_pid = browser_processes[participant_browser][0]
            report.setdefault("participantContexts", []).append({
                "participant": label, "browserPid": browser_pid,
                "contextId": len(contexts), "independentContext": True})

            def frame_identity(frame):
                if frame not in frame_ids:
                    frame_ids[frame] = len(frame_ids) + 1
                return {"frameId": frame_ids[frame], "frameUrl": frame.url,
                    "parentFrameUrl": frame.parent_frame.url if frame.parent_frame else None}

            def on_request(request):
                info = frame_identity(request.frame)
                query = parse_qs(urlparse(request.url if request.is_navigation_request() else info["frameUrl"]).query)
                record = {**stamp(), **info, "id": f"{label}:{len(request_records)+1}",
                    "participant": label, "browserPid": browser_pid, "context": label, "page": label,
                    "url": request.url, "resourceType": request.resource_type,
                    "runtimeEpoch": query.get("runtimeEpoch", [None])[0],
                    "gameGeneration": query.get("gameGeneration", [None])[0],
                    "criticalResource": urlparse(request.url).path.startswith(runtime_prefix) or request.url in sources,
                    "requestFinished": False}
                request_records[request] = record
                if evidence_frozen:
                    record_event("networkRequests", record)
                else:
                    report["networkRequests"].append(record)

            def on_response(response):
                record = request_records.get(response.request)
                update = {"responseAt": round(time.time() * 1000), "responseStatus": response.status,
                    "responseUrl": response.url}
                if record and not evidence_frozen:
                    record.update(update)
                elif record:
                    record_event("networkResponses", {"id": record["id"], **update})
                if response.status >= 400:
                    record_event("httpFailures", {"page": label, "url": response.url,
                        "status": response.status, "requestId": record["id"] if record else None})

            def on_finished(request):
                record = request_records.get(request)
                update = {"requestFinished": True, "finishedAt": round(time.time() * 1000),
                    "timing": request.timing}
                if record and not evidence_frozen:
                    record.update(update)
                elif record:
                    record_event("networkFinished", {"id": record["id"], **update})

            def on_failed(request):
                record = request_records.get(request)
                failure = {"page": label, "participant": label, "browserPid": browser_pid,
                    "requestId": record["id"] if record else None, "url": request.url,
                    "resourceType": request.resource_type, "failure": request.failure,
                    **frame_identity(request.frame), "timing": request.timing,
                    "parentState": cached_parent_states.get(page)}
                if record and not evidence_frozen:
                    record.update(failedAt=round(time.time() * 1000), failure=request.failure)
                record_event("requestFailures", failure)

            page.on("request", on_request)
            page.on("response", on_response)
            page.on("requestfinished", on_finished)
            page.on("requestfailed", on_failed)
            page.on("framenavigated", lambda frame: record_event("pageLifecycle",
                {"page": label, "event": "framenavigated", **frame_identity(frame)}))
            page.on("framedetached", lambda frame: record_event("pageLifecycle",
                {"page": label, "event": "framedetached", **frame_identity(frame)}))
            page.on("close", lambda: record_event("pageLifecycle", {"page": label, "event": "close"}))
            page.on("pageerror", lambda e: record_event("errors", {"page": label, "error": str(e)}))
            page.on("console", lambda m: record_event("console", {"page": label, "type": m.type,
                "text": m.text, "location": m.location}) if m.type in ("warning", "error") else None)
            page.goto(url, wait_until="load", timeout=60000)
            trace(label + ": opening the real product card and multiplayer directory")
            page.wait_for_function("window.__eaglerBoot?.done===true", timeout=60000)
            dismiss_decisions(page)
            page.locator('[data-product="th11mp"]').click()
            page.wait_for_url("**/lobby.html?game=th11mp", timeout=30000)
            page.wait_for_function("!document.querySelector('#createButton')?.disabled", timeout=30000)
            dismiss_decisions(page)
            return page

        def enter_room(page, seat, room=None, watcher=False):
            page.locator("#createButton" if room is None else "#codeButton").click()
            page.locator("#gameSelect").select_option("th11mp")
            if room is None:
                page.locator("#capacitySelect").select_option(str(a.players))
                page.locator("#difficultySelect").select_option("1")
                page.locator("#visibilitySelect").select_option("private")
            else:
                page.locator("#roomCodeInput").fill(room)
            page.locator("#submitRoom").click()
            page.wait_for_function("window.__eaglerBoot?.done===true", timeout=60000)
            dismiss_decisions(page)
            page.wait_for_selector("#mpRoomView:not([hidden])", timeout=30000)
            if not watcher:
                me = page.locator(f'[data-mp-seat-me="{seat}"]')
                page.wait_for_function("seat=>JSON.parse(sessionStorage.getItem('eagler-touhou-th11mp-room-v1')||'null')?.seat===seat || !document.querySelector('[data-mp-seat-drop=\"'+seat+'\"] button')?.disabled", arg=seat, timeout=15000)
                if page.evaluate("JSON.parse(sessionStorage.getItem('eagler-touhou-th11mp-room-v1')).seat") != seat:
                    page.locator(f'[data-mp-seat-drop="{seat}"] button').click()
                page.wait_for_function("seat=>!document.querySelector('[data-mp-seat-me=\"'+seat+'\"]')?.hidden", arg=seat, timeout=15000)
            if a.import_package:
                # Use the real settings drawer, import dialog and file chooser.
                # Never inject a Package Store generation or weaken the hosted
                # installer's refusal of an empty development release catalog.
                page.locator("#mpSettingsRoomDrawerToggle").click()
                page.locator("#mpGamePackageImport").click()
                page.wait_for_selector("#gameDataImportWindow:not([hidden])")
                if seat == 0:
                    screenshot(page, "standard-package-import")
                with page.expect_file_chooser() as chooser:
                    page.locator("#transferImport").click()
                chooser.value.set_files(str(a.import_package))
                wait_for(lambda: page.locator("#gameDataImportWindow").get_attribute("hidden") is not None,
                         "Official local TH11 Package did not finish importing")
                trace("Official real TH11 Package imported through the standard frontend")
                if page.locator("#mpSettingsRoomDrawerToggle").get_attribute("aria-expanded") == "true":
                    # The open drawer intentionally hides its entry cue.
                    # Its original Escape handler closes the modal and restores
                    # the room; do not force-click the obscured entry button.
                    page.locator("#mpGamePackageImport").focus()
                    page.keyboard.press("Escape")
                    page.wait_for_selector("#mpSettingsRoomDrawer[hidden]", state="attached")
            # These are published custom selects: the native select retains
            # its standard change handler and option values.
            select = page.locator("#mpMusicSelect")
            if select.count():
                select.select_option("none", force=True)
            return page.locator("#mpRoomCode").inner_text().strip()

        host = new_page("P1")
        room = enter_room(host, 0)
        assert re.fullmatch(r"\d{4,8}", room), room
        for seat in range(1, a.players):
            enter_room(new_page(f"P{seat+1}"), seat, room)
        live = pages[:a.players]
        viewer = None
        if a.spectator:
            viewer = new_page("start-spectator")
            enter_room(viewer, None, room, watcher=True)
            viewer.locator("#mpSpectatorToggle").click()
            viewer.locator("#mpSpectatorJoin").click()
            viewer.locator("#mpRoomPanelClose").click()
            viewer.wait_for_function("JSON.parse(sessionStorage.getItem('eagler-touhou-th11mp-room-v1')).spectatorRequested===true")
            # spectatorRequested is optimistic local preference. These rows
            # are rendered only from the server's authoritative room roster.
            wait_for(lambda: viewer.locator("#mpSpectatorList .mp-spectator-entry.mine").count() == 1
                and host.locator("#mpSpectatorList .mp-spectator-entry").count() == 1,
                "Server did not acknowledge the spectator before room start")
            report["spectatorAdmission"] = {"authoritativeMineRows": 1, "hostRosterRows": 1,
                "hostCount": host.locator("#mpSpectatorCount").inner_text()}
        if a.challenge:
            host.locator("#mpRoomSettingsToggle").click()
            host.wait_for_selector("#mpRoomPanel[open][data-panel='game']")
            challenge = host.locator("#mpRoomRuleModes [data-room-rule='challenge']")
            assert challenge.get_attribute("aria-pressed") == "false"
            challenge.click()
            # The button reflects server room snapshots, not optimistic local
            # options. Every participant must observe the authoritative rule.
            wait_for(lambda: all(page.locator("[data-room-rule='challenge']").get_attribute("aria-pressed") == "true"
                and page.evaluate("JSON.parse(sessionStorage.getItem('eagler-touhou-th11mp-room-v1')).room.challengeMode") is True
                for page in pages), "The real Challenge room rule did not synchronize")
            report["challengeRoom"] = {"authoritativeParticipants": len(pages),
                "toggle": challenge.inner_text(), "identities": [page.evaluate(IDENTITY) for page in pages]}
            screenshot(host, "standard-challenge-room")
            host.locator("#mpRoomPanelClose").click()
            host.wait_for_selector("#mpRoomPanel:not([open])", state="attached")
        before_identity = host.evaluate(IDENTITY)
        report["room"] = room
        trace("Real room " + room + " has all requested players and admitted spectators")
        screenshot(host, "standard-room")
        for seat, page in enumerate(live):
            assert page.locator("#mpRollbackToggle").get_attribute("aria-checked") == "false"
            assert page.locator("#mpRollbackToggle").is_disabled()
            page.locator("#mpRollbackToggle").evaluate("toggle => toggle.dispatchEvent(new MouseEvent('click', {bubbles:true}))")
            assert page.locator("#mpRollbackToggle").get_attribute("aria-checked") == "false"
            assert page.locator("#mpRollbackToggle").is_disabled()
            page.locator("#mpReady").click()
        wait_for(lambda: host.locator("#mpStartGame").is_enabled(), "Room readiness did not permit start")
        trace("Starting the real room; observing per-participant resource delivery and native measurement")
        report["startupBeganAt"] = round(time.time() * 1000)
        host.locator("#mpStartGame").click()
        def measured():
            states = [snapshot(page) for page in live]
            if viewer:
                snapshot(viewer)
            report["startupCandidates"] = states
            report["startupParents"] = {page_labels[page]: cached_parent_states.get(page) for page in pages}
            for page in pages:
                parent = cached_parent_states.get(page) or {}
                active_url = parent.get("frameUrl")
                fatal = [e for e in report["runtimeProtocol"].get(page_labels[page], [])
                    if e.get("event") == "error" and e.get("frameUrl") == active_url
                    and e.get("observedAt", 0) >= report["startupBeganAt"]]
                failed_resources = [r for r in report["networkRequests"] if r["page"] == page_labels[page]
                    and r["criticalResource"] and r.get("failure") and r["at"] >= report["startupBeganAt"]
                    and (r["frameUrl"] == active_url or r["url"] == active_url)]
                startup_error = parent.get("startupError") or {}
                if fatal or failed_resources or (startup_error.get("visible") and startup_error.get("text")):
                    report["startupFatal"] = {"page": page_labels[page], "parent": parent,
                        "runtimeErrors": fatal, "failedResources": failed_resources}
                    raise AssertionError("Active Runtime startup failed before native measurement: " + page_labels[page])
            return states if all(s and s["calibration"][1] == 5 and s["net"][3] != UINT32_MAX and s["net"][3] >= 60 for s in states) else None

        started = wait_for(measured, "Measured frame zero did not start", 180)
        trace("Standard frontend connection measurement committed; native gameplay running")
        for s in started:
            check_runtime(s)
        assert all(s["net"][7] == started[0]["net"][7] for s in started), started
        report["startup"] = started
        if viewer:
            report["spectatorBeforeInput"] = snapshot(viewer)
        if a.startup_only:
            if viewer:
                wait_for(lambda: (s := snapshot(viewer)) and s["net"][3] != UINT32_MAX and s["net"][3] >= 60,
                    "Startup diagnostic spectator did not reach native F60")
                check_runtime(snapshot(viewer), spectator=True)
                report["spectatorStart"] = snapshot(viewer)
            report["connection"] = [page.evaluate("__th11LauncherGate.views") for page in live]
            report["timing"] = [page.evaluate("__th11LauncherGate.events.filter(e=>e.event==='runtime-info'&&e.netplayTiming?.phase==='ready').map(e=>e.netplayTiming)") for page in live]
            assert all(any(v["phase"] == "ready" for v in views) for views in report["connection"])
            report["startupDiagnostic"] = {"measuredPlayersAtLeastF60": a.players,
                "spectatorAtLeastF60": bool(viewer), "scope": "Resource delivery and measured native start only"}
            report["passed"] = True
            trace("Startup diagnostic passed; complete gameplay acceptance was not run")
            return 0
        for seat, page in enumerate(live):
            trace(f"P{seat+1}: sending real held fire and movement input")
            key(page, "KeyZ", True)
            key(page, "ArrowLeft" if seat % 2 == 0 else "ArrowRight", True)
        if viewer:
            trace("Observing the admitted spectator's real native confirmed frames")
            wait_for(lambda: snapshot(viewer) and snapshot(viewer)["net"][3] != UINT32_MAX and snapshot(viewer)["net"][3] >= 60, "Admitted spectator did not receive native confirmed frames")
            check_runtime(snapshot(viewer), spectator=True)
            trace("Admitted native spectator reached F60; checking that physical input cannot control it")
            key(viewer, "KeyR")
            key(viewer, "KeyX")
            key(viewer, "ArrowUp")
            report["spectatorStart"] = snapshot(viewer)

        target = 150 if a.restart else a.frames
        wait_for(lambda: all((s := snapshot(page)) and s["net"][3] >= target for page in live), "Live game did not advance")
        report["gameplayBeforeCapture"] = [snapshot(page) for page in live]
        if not a.restart:
            screenshot(host, "native-gameplay")
            native_canvas(host, "native-gameplay-canvas")
            for seat, page in enumerate(live):
                key(page, "KeyZ", False)
                key(page, "ArrowLeft" if seat % 2 == 0 else "ArrowRight", False)
            key(host, "Escape")
            wait_for(lambda: all((s := snapshot(page)) and s["game"][3] == 2 for page in live), "P1 pause did not synchronize before opening the standard report")
            pause_frame = max(snapshot(page)["net"][3] for page in live)
            wait_for(lambda: min(snapshot(page)["net"][3] for page in live) >= pause_frame + 20, "Native pause entrance did not finish")
            report["pause"] = [snapshot(page) for page in live]
            calibration_report(host)
            key(host, "Escape")
            wait_for(lambda: all(snapshot(page)["game"][3] != 2 for page in live), "Native Pause did not resume after the standard report")
        if a.restart:
            for seat, page in enumerate(live):
                key(page, "KeyZ", False)
                key(page, "ArrowLeft" if seat % 2 == 0 else "ArrowRight", False)
            key(host, "Escape")
            wait_for(lambda: all((s := snapshot(page)) and s["game"][3] == 2 for page in live), "P1 pause did not synchronize")
            pause_frame = max(snapshot(page)["net"][3] for page in live)
            wait_for(lambda: min(snapshot(page)["net"][3] for page in live) >= pause_frame + 20, "Native pause entrance did not finish")
            report["pause"] = [snapshot(page) for page in live]
            screenshot(host, "native-pause")
            report["nativePauseViews"] = []
            for seat, page in enumerate(live):
                view = snapshot(page)
                report["nativePauseViews"].append({"participant": f"P{seat+1}",
                    "localPlayer": view["options"].get("netplayPlayer"), "frame": view["net"][3],
                    "phase": view["game"][3], "localGraze": view["game"][8+seat*16+7],
                    "seatStatus": view["game"][8+seat*16:8+(seat+1)*16],
                    "image": f"native-pause-P{seat+1}-canvas", "graphics": view["graphics"]})
                native_canvas(page, f"native-pause-P{seat+1}-canvas")
            # The ready connection window automatically hides after 8 seconds.
            # Its actual views remain asserted below. Use the existing stable
            # report dialog after the original native pause for visual evidence.
            calibration_report(host)
            if a.restart_menu:
                menu_tap(host, "ArrowDown")
                menu_tap(host, "ArrowDown")
                menu_tap(host, "ArrowDown")
                native_canvas(host, "native-pause-restart-selected")
                key(host, "KeyZ", True)
            else:
                key(host, "KeyR")
            report["restartControl"] = "native-pause-menu" if a.restart_menu else "R"
            trace("P1 requested native synchronized " + report["restartControl"] + "; awaiting fresh generation measurement")
            wait_for(lambda: all((s := snapshot(page)) and s["net"][12] == 1 and s["calibration"][1] == 5 for page in live), "Restart did not remeasure and begin generation 1", 180)
            if a.restart_menu:
                host.keyboard.up("KeyZ")
            for page in live:
                check_runtime(snapshot(page))
            for seat, page in enumerate(live):
                key(page, "KeyZ", True)
                key(page, "ArrowLeft" if seat % 2 == 0 else "ArrowRight", True)
            wait_for(lambda: all(snapshot(page)["net"][3] != UINT32_MAX and snapshot(page)["net"][3] >= a.frames for page in live), "New generation did not advance")
            wait_for(lambda: not viewer.locator("#player").evaluate("n=>n.classList.contains('open')"), "Old spectator admission did not return through standard exit")
            report["spectatorReturn"] = viewer.evaluate(IDENTITY)
            assert report["spectatorReturn"]["roomVisible"]
            assert report["spectatorReturn"]["room"]["room"]["code"] == room

        generation = 1 if a.restart else 0
        histories = [history(page, generation) for page in live]
        report["sameFrame"] = compare(histories, "players")
        trace("Same-frame native world checks passed for all live players")
        moved = [seat for seat in range(a.players) if len({s["game"][8+seat*16+9] for s in histories[0].values()}) > 1]
        assert len(moved) == a.players, ("Every seat must move through real browser input", moved)
        report["movedSeats"] = moved
        reference = history(host, 0)
        if viewer:
            report["spectatorSameFrame"] = compare([reference, history(viewer, 0)], "spectator")
            assert all(s["net"][15] == 0 for s in history(viewer, 0).values())
        report["connection"] = [page.evaluate("__th11LauncherGate.views") for page in live]
        report["timing"] = [page.evaluate("__th11LauncherGate.events.filter(e=>e.event==='runtime-info'&&e.netplayTiming?.phase==='ready').map(e=>e.netplayTiming)") for page in live]
        for views, timing in zip(report["connection"], report["timing"]):
            ready = [view for view in views if view["phase"] == "ready"]
            assert ready, ("Missing standard measured connection window", views)
            assert all(v["scrollWidth"] <= v["width"] + 1 for v in ready)
            assert all(re.search(r"最大延迟|Maximum latency", v["text"]) and re.search(r"输入延迟|Input delay", v["text"]) for v in ready)
            assert len(timing) >= (2 if a.restart else 1), timing
            assert all(t["adonisMode"] == 1 and t["inputDelay"] >= 1 and t["calibration"]["game"] == "th11mp" for t in timing)
        for page in live:
            assert not page.evaluate("__th11LauncherGate.observerErrors")
            assert snapshot(page)["legacyPanels"] == []

        if a.spectator:
            key(host, "Escape")
            wait_for(lambda: all(snapshot(page)["game"][3] == 2 for page in live), "P1 could not hold the live game in its native pause while checking late admission")
            late = new_page("late-spectator")
            enter_room(late, None, room, watcher=True)
            late.locator("#mpSpectatorToggle").click()
            button = late.locator("#mpSpectatorJoin")
            if button.is_visible() and button.is_enabled():
                button.click()
            late.wait_for_timeout(800)
            assert not snapshot(late) or not snapshot(late)["active"], "A late observer must not enter an admitted run"
            report["startOnlyAdmission"] = {"lateRuntimeStarted": False, "ui": late.locator("#mpRoomPanel").inner_text()}
            screenshot(late, "standard-late-spectator")
            late.locator("#mpRoomPanelClose").click()

        if a.disconnect:
            for seat, page in enumerate(live):
                key(page, "KeyZ", False)
                key(page, "ArrowLeft" if seat % 2 == 0 else "ArrowRight", False)
            contexts[1].close()
            trace("Closed P2's real BrowserContext; awaiting standard frontend return")
            wait_for(lambda: host.locator("#netplayConnectionReturn").is_visible(), "A real peer loss did not expose the standard return button", 45)
            # The standard transport window exposes Return while native input
            # timeout detection is still pending. Observe the actual failure
            # separately instead of treating the first reconnect frame as fatal.
            failed = wait_for(lambda: (s if (s := snapshot(host)) and
                (s["error"] or s["globals"].get("failed")) else None),
                "Peer loss never reached native fail-closed status", 45)
            frozen = failed["net"][3]
            host.wait_for_timeout(500)
            assert snapshot(host)["net"][3] == frozen, "Disconnected native world kept advancing"
            screenshot(host, "standard-disconnect")
            host.locator("#netplayConnectionReturn").click()
            wait_for(lambda: not host.locator("#player").evaluate("n=>n.classList.contains('open')"), "Standard return did not close Runtime")
            after_identity = host.evaluate(IDENTITY)
            assert after_identity["member"] == before_identity["member"]
            assert after_identity["client"] == before_identity["client"]
            assert after_identity["room"]["room"]["code"] == room and after_identity["room"]["seat"] == 0
            assert after_identity["roomVisible"] and "0" in after_identity["me"], after_identity
            report["disconnect"] = {"nativeError": failed["error"], "frozenFrame": frozen,
                "standardReturn": True, "sameMember": True, "sameClient": True, "sameRoom": True, "sameSeat": True}
            screenshot(host, "standard-returned-room")

        if a.replay:
            trace("Opening the original Replay list from the real Launcher")
            host.locator("#mpLeaveRoom").click()
            host.goto(url + "?game=th11mp", wait_until="load")
            host.wait_for_function("window.__eaglerBoot?.done===true", timeout=60000)
            dismiss_decisions(host)
            host.locator("#mpReplayViewer").click()
            native_list = lambda: ((s := snapshot(host)) and s["replayUi"][1] == 1 and s["replayUi"][5:7] == [11, 2])
            wait_for(native_list, "Real Launcher Replay did not open the native list")
            files = host.evaluate("""async expectedWasm => {
             const r=document.querySelector('#gameFrame').contentWindow;
             const {inspectMultiplayerReplay}=await import(new URL('./multiplayer-replay.mjs',r.location.href));
             const buildWords=Array.from({length:4},(_,i)=>parseInt(expectedWasm.slice(i*8,i*8+8),16)>>>0);
             const validate=bytes=>{
              const pointer=r.core.malloc(bytes.length);
              if(!pointer)throw Error('No memory for saved Replay validation');
              try{r.Module.HEAPU8.set(bytes,pointer);return r.core.th11_mp_replay_validate(pointer,bytes.length)===1;}
              finally{r.core.free(pointer);}
             };
             return r.Module.FS.readdir('/savesth11mp/replay').filter(n=>/^th11_.*\\.rpy$/.test(n))
              .map(name=>{const bytes=r.Module.FS.readFile('/savesth11mp/replay/'+name);
               const metadata=inspectMultiplayerReplay(bytes,{validate,buildWords});
               return {name,bytes:bytes.length,challenge:metadata.challenge,frameCount:metadata.frameCount,
                playerCount:metadata.playerCount,recordedPlayer:metadata.recordedPlayer,buildWords:metadata.buildWords};});
            }""", a.expected_wasm)
            assert files and all(f["bytes"] > 128 for f in files), files
            assert all(f["challenge"] == a.challenge and f["playerCount"] == a.players for f in files), files
            screenshot(host, "native-replay-list")
            key(host, "KeyZ")
            wait_for(lambda: snapshot(host)["replayUi"][6] == 4, "Native Replay stage selection did not open")
            screenshot(host, "native-replay-stage")
            host.wait_for_timeout(350)
            key(host, "KeyZ")
            wait_for(lambda: snapshot(host)["replayUi"][1] == 2 and snapshot(host)["net"][3] >= 100, "Native Replay did not play real saved inputs")
            playback = snapshot(host)
            assert playback["replayUi"][9] == 0 and playback["net"][12] == 0, playback
            screenshot(host, "native-replay-playback")
            report["replay"] = {"files": files, "nativeSelectedSlot": playback["replayUi"][9] + 1,
                "generation": playback["net"][12], "replayUi": playback["replayUi"],
                "challenge": a.challenge, "productionBrowserParserAndNativeValidation": True,
                "sameFrame": compare([reference, history(host, 0, replay=True)], "saved native Replay")}
            key(host, "Escape")
            wait_for(native_list, "Playback Esc did not return to native Replay list")
            key(host, "Escape")
            wait_for(lambda: not host.locator("#player").evaluate("n=>n.classList.contains('open')"), "Native Replay exit did not return to the real Launcher")
            report["replay"].update(nativeList=True, nativeStageSelection=True, nativePlayback=True, nativeEscape=True, launcherExit=True)
            screenshot(host, "standard-replay-return")

        if a.return_menu:
            for seat, page in enumerate(live):
                key(page, "KeyZ", False)
                key(page, "ArrowLeft" if seat % 2 == 0 else "ArrowRight", False)
            if snapshot(host)["game"][3] != 2:
                key(host, "Escape")
            wait_for(lambda: all(snapshot(page)["game"][3] == 2 for page in live), "Return test could not pause all players")
            entry_frame = max(snapshot(page)["net"][3] for page in live)
            wait_for(lambda: min(snapshot(page)["net"][3] for page in live) >= entry_frame + 20, "Return pause entrance did not finish")
            menu_tap(host, "ArrowDown")
            native_canvas(host, "native-pause-return-selected")
            key(host, "KeyZ", True)
            def returned():
                report["returnCandidates"] = [snapshot(page) for page in live]
                report["returnIdentities"] = [page.evaluate(IDENTITY) for page in live]
                return all(not page.locator("#player").evaluate("node=>node.classList.contains('open')")
                    and identity["room"] is None for page, identity in zip(live, report["returnIdentities"]))
            wait_for(returned, "Native Return did not end both runtimes and leave both room seats", 45)
            host.keyboard.up("KeyZ")
            report["nativeReturnToMenu"] = [page.evaluate(IDENTITY) for page in live]
            report["returnDirectorySnapshots"] = []
            for page in live:
                assert not page.evaluate(IDENTITY)["roomVisible"]
                member = page.evaluate(IDENTITY)["member"]
                reply = page.evaluate("""({relay,member})=>new Promise((resolve,reject)=>{
                  const url=new URL(relay);url.searchParams.set('directory','1');url.searchParams.set('member',member);
                  const socket=new WebSocket(url),timer=setTimeout(()=>{socket.close();reject(Error('Room membership still occupied'));},10000);
                  socket.onmessage=event=>{const value=JSON.parse(event.data);if(value.type==='directory'&&value.mine===null){clearTimeout(timer);socket.close();resolve(value);}};
                  socket.onerror=()=>{clearTimeout(timer);reject(Error('Directory verification failed'));};
                })""", {"relay": relay_url, "member": member})
                report["returnDirectorySnapshots"].append({"mine": reply["mine"], "version": reply["version"]})
            report["returnRoomMembershipReleased"] = True
            screenshot(host, "standard-native-return")
            trace("Native Return ended both players and released both room identities")

        assert not report["errors"], report["errors"]
        report["passed"] = True
    except Exception as error:
        report["failure"] = str(error)
        report["traceback"] = traceback.format_exc()
        report["failurePages"] = [{"page": index, "url": page.url,
            "participant": page_labels.get(page), "lastObservedNative": cached_snapshots.get(page),
            "lastObservedParent": cached_parent_states.get(page)}
            for index, page in enumerate(pages) if not page.is_closed()]
        trace("Acceptance failed: " + str(error))
        a.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    finally:
        # Freeze primary evidence before closing any page. Requests cancelled
        # by cleanup are retained separately and cannot become startup causes.
        evidence_frozen = True
        report["evidenceFrozenAt"] = round(time.time() * 1000)
        report["lastParents"] = {page_labels[page]: value for page, value in cached_parent_states.items()}
        a.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        for owned_browser in reversed(browsers):
            def terminate_owned_browser(target=owned_browser):
                identity = browser_processes.get(target)
                if identity and process_creation(identity[0]) == identity[1]:
                    command = ["taskkill", "/PID", str(identity[0]), "/T", "/F"] if os.name == "nt" else ["kill", "-TERM", str(identity[0])]
                    result = subprocess.run(command, capture_output=True, timeout=15)
                    report.setdefault("boundedBrowserCleanup", []).append({"pid": identity[0], "exitCode": result.returncode})
            cleanup_timer = threading.Timer(5, terminate_owned_browser)
            cleanup_timer.daemon = True
            cleanup_timer.start()
            try:
                owned_browser.close()
            except Exception as cleanup_error:
                report.setdefault("cleanupErrors", []).append(str(cleanup_error))
            finally:
                cleanup_timer.cancel()
                cleanup_timer.join(timeout=20)
        if playwright:
            playwright.stop()
        for child in reversed(children):
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)
        for log in logs:
            log.close()
        a.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if not report["passed"]:
        print(report.get("failure", "Acceptance failed"))
        print(report.get("traceback", ""))
        return 1
    print(f"TH11 {a.players}P {a.route}: actual Launcher and production native Runtime PASS; {a.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
