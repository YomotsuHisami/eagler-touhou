"""Issue 21: real 3P + spectator Runtime/bridge regression.

Requires Playwright and explicit candidate runtimes with artifact-only
KeyboardProbe{Buttons,Focus,Stage} exports. No release binaries are modified.
The fixture bundles the actual React RuntimeHost keyboard binding, not copies.
"""
from __future__ import annotations

import argparse
import functools
import http.server
import json
import os
from pathlib import Path
import socket
import subprocess
import threading
import time
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def host_html(game):
    return ('''<!doctype html><meta charset="utf-8"><title>Keyboard ownership regression</title>
<div id="player" class="open"><iframe id="runtime" width="640" height="480"></iframe></div>
<button id="control">Launcher control</button><pre id="status">boot</pre>
<script type="module">
import { HostedKeyboard, bindRuntimeKeyboard, deliverRuntimeInput } from '/modules/runtime-keyboard-binding.mjs';
const protocol='eagler-touhou/1', epoch=1, game=GAME;
const params=new URLSearchParams(location.search), spectator=params.get('spectator')==='1';
const frame=document.getElementById('runtime'), player=document.getElementById('player');
const state={launched:false,game};
function getInputContext() { return {target:frame.contentWindow,targetOrigin:location.origin,
  protocol,game,epoch,launched:state.launched,ready:state.launched,spectator}; }
const keyboard=new HostedKeyboard(), keyboardMessages=[];
const service={getInputContext,postInput(command,payload){
  const context=getInputContext();
  if(!context.ready||!context.launched||context.spectator)return false;
  const message={...payload,protocol,game,epoch,command};
  keyboardMessages.push(message);return deliverRuntimeInput(context,message);
}};
let detachKeyboard;
function attachKeyboard(){detachKeyboard=bindRuntimeKeyboard({host:window,document,element:Element,
  frame:()=>frame,service,keyboard});}
attachKeyboard();
globalThis.keyboardFixture={messages:keyboardMessages,detach(){detachKeyboard();},attach:attachKeyboard};
const pending=new Map(); let request=0;
function send(command,body={}) { return new Promise((resolve,reject)=>{
  const id='keyboard-'+(++request); pending.set(id,{resolve,reject});
  frame.contentWindow.postMessage({protocol,game,epoch,command,request:id,...body},location.origin);
  setTimeout(()=>{if(pending.delete(id))reject(new Error(command+' timeout'));},15000);
}); }
addEventListener('message',async event=>{
  if(event.source!==frame.contentWindow||event.origin!==location.origin)return;
  const msg=event.data||{};
  if(msg.protocol!==protocol||msg.game!==game||msg.epoch!==epoch)return;
  if(pending.has(msg.request)) {const waiter=pending.get(msg.request);pending.delete(msg.request);
    if(msg.ok)waiter.resolve(msg);else waiter.reject(new Error(msg.error));return;}
  if(msg.event!=='ready')return;
  try {
    await send('configure',{music:'none',resources:[],
      sharedResources:[{url:'/assets/'+game+'/msgothic.ttc',path:'/msgothic.ttc'}],thpracCatalog:[],
      options:{debugHarness:'netplay-lan-stage1',netplayMode:'lan',netplayUrl:params.get('relay'),
        netplayPlayer:Number(params.get('player')||0),netplayPlayerCount:3,netplayTestFrames:7200,
        netplaySeed:19005,netplayDifficulty:1,netplayIceServers:[],
        netplayLoadouts:[{character:0,shot:0},{character:1,shot:1},{character:0,shot:1}],
        netplayPhysicalInput:true,netplayScriptedInput:false,netplayRollbackProbe:true,
        netplaySpectator:spectator,netplaySpectatorId:spectator?'spectator_0004':'',netplaySpectatorCount:1}});
    await send('launch');state.launched=true;globalThis.keyboardLaunched=true;
    document.getElementById('status').textContent='launched';
  } catch(error) {globalThis.keyboardFailure=String(error);}
});
frame.src='/runtime/'+game+'/'+game+'.html?hosted=1&runtimeVariant=multiplayer&runtimeEpoch=1';
</script>'''.replace("GAME", json.dumps(game))).encode()


class Handler(http.server.SimpleHTTPRequestHandler):
    runtimes = {}
    workspace = None
    keyboard_module = None

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/modules/runtime-keyboard-binding.mjs":
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(self.keyboard_module)))
            self.end_headers()
            self.wfile.write(self.keyboard_module)
        elif parsed.path == "/host":
            game = parse_qs(parsed.query)["game"][0]
            body = host_html(game)
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            super().do_GET()

    def translate_path(self, path):
        parts = urlparse(path).path.strip("/").split("/")
        if any(part in (".", "..") for part in parts):
            return str(ROOT / "missing")
        if parts[0] == "runtime" and len(parts) >= 3:
            return str(self.runtimes[parts[1]].joinpath(*parts[2:]))
        if parts[0] == "assets" and len(parts) >= 3:
            return str((self.workspace / (parts[1] + "-eagler") / "assets").joinpath(*parts[2:]))
        return super().translate_path(path)

    def log_message(self, *_):
        pass


def admit_lobby(setup, relay, room):
    return setup.evaluate('''async ({relay,room}) => {
      async function connect(id) {
        const intent=id==='player_1_0001'?'create':'join';
        const ws=new WebSocket(`${relay}/?room=${room}&lobby=${id}&players=3&difficulty=1&visibility=private&intent=${intent}`);
        const queue=[],waiters=[]; let last;
        ws.onmessage=e=>{const value=JSON.parse(e.data);last=value;const f=waiters.shift();if(f)f(value);else queue.push(value);};
        await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
        return {ws,next(){if(queue.length)return Promise.resolve(queue.shift());
          return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('lobby timeout '+id+' '+JSON.stringify(last))),10000);
            waiters.push(v=>{clearTimeout(timer);resolve(v);});});}};
      }
      async function until(c,predicate) {for(;;){const v=await c.next();if(v.type==='error')throw new Error(v.error);if(predicate(v))return v;}}
      const players=[];
      for(let i=1;i<=3;i++){const c=await connect('player_'+i+'_000'+i);await c.next();players.push(c);}
      const spectator=await connect('spectator_0004');await spectator.next();
      for(let i=0;i<3;i++)players[i].ws.send(JSON.stringify({type:'take-seat',seat:i,loadout:i}));
      spectator.ws.send(JSON.stringify({type:'spectate'}));
      const ready=(v,requireReady)=>v.type==='state'&&v.room?.playerCount===3&&v.room?.spectatorCount===1&&
        v.room.seats.slice(0,3).every(s=>s&&(!requireReady||s.ready));
      await until(spectator,v=>ready(v,false));
      for(const p of players)p.ws.send(JSON.stringify({type:'set-ready',ready:true}));
      await until(spectator,v=>ready(v,true));
      const started=until(spectator,v=>v.type==='start');players[0].ws.send(JSON.stringify({type:'start'}));
      globalThis.lobbySockets=[...players.map(p=>p.ws),spectator.ws];return await started;
    }''', {"relay": relay, "room": room})


def snapshot(page):
    return page.evaluate('''() => {
      const r=document.getElementById('runtime').contentWindow,m=r.Module;
      const t=r.__th06PeerTransport||r.__th07PeerTransport;
      return {launched:!!globalThis.keyboardLaunched,error:String(globalThis.keyboardFailure||t?.error||r.__eaglerNetplayError||''),
        active:!!r.__eaglerNetplayLanActive,frame:Number(r.__eaglerNetplayLanFrame||0),route:t?.route,
        confirmed:Number(r.__eaglerNetplayLanConfirmed??-1),spectator:!!r.__eaglerNetplaySpectator,
        bits:Number(m?.eaglerControls?.keyboardBits||0),pulse:Number(m?.eaglerControls?.keyboardPulseBits||0),
        buttons:m?._KeyboardProbeButtons?[0,1,2].map(i=>m._KeyboardProbeButtons(i)):null,
        focus:m?._KeyboardProbeFocus?[0,1,2].map(i=>m._KeyboardProbeFocus(i)):null,
        stage:m?._KeyboardProbeStage?.(),sdlShift:m?._KeyboardProbeSDLShift?.(),
        physicalInput:!!m?.eaglerOptions?.netplayPhysicalInput,scriptedInput:!!m?.eaglerOptions?.netplayScriptedInput,
        scriptedLifecycle:!!m?.eaglerOptions?.netplayStageTransition,hashes:r.__eaglerNetplayLanHashes||{}};
    }''')


def wait_state(pages, predicate, label, timeout=12):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        states = [snapshot(p) for p in pages]
        if any(s["error"] for s in states):
            raise AssertionError(f"{label}: {states}")
        if predicate(states):
            return states
        pages[0].wait_for_timeout(50)
    raise AssertionError(f"{label} timeout: {states}")


def key(page, down, code="ShiftLeft", location=1, keycode=16, target="host", repeat=False, keyname="Shift", alt=False):
    page.evaluate('''args=>{
      const [down,code,location,keyCode,target,repeat,key,altKey]=args;
      const init={bubbles:true,cancelable:true,key,code,location,keyCode,which:keyCode,repeat,altKey};
      if(target==='native') {const r=document.getElementById('runtime').contentWindow;r.dispatchEvent(new r.KeyboardEvent(down?'keydown':'keyup',init));}
      else document.getElementById(target==='control'?'control':'player').dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',init));
    }''', [down, code, location, keycode, target, repeat, keyname, alt])


def run_game(browser, base, relay, game, route):
    room = f"{game}mp-keyboard-{time.time_ns()}"
    setup = browser.new_context().new_page()
    setup.goto(base)
    admit_lobby(setup, relay, room)
    pages = []
    from urllib.parse import urlencode
    for i in range(4):
        context = browser.new_context()
        if route == "ws":
            context.add_init_script("delete globalThis.RTCPeerConnection")
        page = context.new_page()
        pages.append(page)
        options = {"game": game, "player": min(i, 2), "spectator": int(i == 3),
                   "relay": f"{relay}/?room={room}&run=1&players=3&player={min(i,2)}" + ("&spectator=spectator_0004" if i == 3 else "")}
        page.goto(base + "/host?" + urlencode(options), wait_until="domcontentloaded")
    states = wait_state(pages, lambda ss: all(s["active"] and s["frame"] >= 90 and s["buttons"] for s in ss), "3P+spectator boot", 60)
    assert all(s["physicalInput"] and not s["scriptedInput"] and not s["scriptedLifecycle"] for s in states), states
    checks = []

    def focus(seat, value, label):
        states = wait_state(pages, lambda ss: all(bool(s["buttons"][seat] & 4) == bool(value)
            and bool(s["focus"][seat]) == bool(value) for s in ss), label)
        checks.append({"test": label, "seat": seat, "focus": value, "frames": [s["frame"] for s in states]})

    # Original trigger: nonhost presses over game, releases over Launcher UI;
    # all three event identity fields change, without a blur hiding the bug.
    key(pages[2], True)
    focus(2, 1, "P3 hosted DOWN")
    key(pages[2], False, "Unidentified", 0, 0, "control")
    focus(2, 0, "P3 changed identity UP over Launcher control")

    for seat, order in [(1, ["ShiftLeft", "ShiftRight"]), (2, ["ShiftRight", "ShiftLeft"])]:
        key(pages[seat], True, "ShiftLeft", 1)
        key(pages[seat], True, "ShiftRight", 2)
        focus(seat, 1, "both Shift held")
        key(pages[seat], False, order[0], 0)
        focus(seat, 1, "one Shift released, other remains held")
        key(pages[seat], False, order[1], 0)
        focus(seat, 0, "both Shift released")

    key(pages[2], True, target="native")
    focus(2, 1, "P3 Runtime native DOWN")
    key(pages[2], False, "Unidentified", 0, 0, "native")
    focus(2, 0, "P3 Runtime unidentified release")

    # Real native DOWN latches SDL; window-only unidentified UP retires the
    # shell owner without clearing SDL's document listener. SDL must not OR
    # stale Focus back into the authoritative browser keyboard state.
    pages[2].frames[1].locator("#canvas").focus()
    pages[2].keyboard.down("Shift")
    focus(2, 1, "real native Shift DOWN")
    assert snapshot(pages[2])["sdlShift"] == 1
    key(pages[2], False, "Unidentified", 0, 0, "native")
    focus(2, 0, "stale SDL Shift cannot resurrect released Focus")
    assert snapshot(pages[2])["sdlShift"] == 1
    checks[-1]["sdlShiftAfterRelease"] = 1
    pages[2].keyboard.up("Shift")

    key(pages[1], True)
    focus(1, 1, "P2 held before lifecycle cancellation")
    pages[1].evaluate("dispatchEvent(new Event('pagehide'))")
    focus(1, 0, "pagehide clears held owner")
    key(pages[1], True, repeat=True)
    key(pages[1], False, "Unidentified", 0, 0)
    pages[0].wait_for_timeout(250)
    focus(1, 0, "cancelled repeat and orphan UP remain neutral")
    key(pages[1], True)
    focus(1, 1, "fresh DOWN after lifecycle cancellation")
    # Real C++ reset hook must clear the hidden owner Map too. KeyX update
    # republishing it afterwards must not reassert Focus.
    pages[1].evaluate("document.getElementById('runtime').contentWindow.Module._KeyboardProbeReset()")
    key(pages[1], False)
    focus(1, 0, "Runtime full keyboard reset")

    key(pages[3], True)
    key(pages[3], False, "Unidentified", 0, 0, "control")
    states = wait_state(pages, lambda ss: all(not any(x & 4 for x in s["buttons"]) for s in ss), "spectator input isolation")
    assert states[3]["bits"] == 0
    checks.append({"test": "spectator input isolation", "focus": 0})

    # The real host binding must reserve both chord edges, even when Alt is
    # released before Enter, without sending a release-only native Enter.
    before = pages[1].evaluate("keyboardFixture.messages.length")
    key(pages[1], True, "Enter", 0, 13, keyname="Enter", alt=True)
    key(pages[1], True, "Enter", 0, 13, repeat=True, keyname="Enter", alt=True)
    key(pages[1], False, "AltLeft", 1, 18, keyname="Alt")
    key(pages[1], False, "Enter", 0, 13, keyname="Enter")
    assert pages[1].evaluate("keyboardFixture.messages.length") == before
    checks.append({"test": "Alt+Enter never forwards native keyboard input"})

    key(pages[1], True)
    focus(1, 1, "host owner before binding detach")
    pages[1].evaluate("keyboardFixture.detach()")
    focus(1, 0, "binding detach clears the connected Runtime")
    before = pages[1].evaluate("keyboardFixture.messages.length")
    key(pages[1], True)
    key(pages[1], False)
    pages[1].evaluate("dispatchEvent(new Event('pagehide'))")
    assert pages[1].evaluate("keyboardFixture.messages.length") == before
    pages[1].evaluate("keyboardFixture.attach()")
    key(pages[1], True, repeat=True)
    key(pages[1], False)
    assert pages[1].evaluate("keyboardFixture.messages.length") == before
    key(pages[1], True)
    focus(1, 1, "fresh host owner after binding reattach")
    key(pages[1], False, target="control")
    focus(1, 0, "reattached host releases over Launcher chrome")

    # Compare an identical already confirmed frame across every participant.
    def coherent(ss):
        keys = set(ss[0]["hashes"])
        for s in ss[1:]:
            keys &= set(s["hashes"])
        keys = [k for k in keys if int(k) > checks[-2].get("frames", [0])[0]]
        return bool(keys)
    states = wait_state(pages, coherent, "post-regression confirmed hashes")
    common = set.intersection(*(set(s["hashes"]) for s in states))
    frame = max(common, key=int)
    hashes = [s["hashes"][frame] for s in states]
    assert len(set(hashes)) == 1, (frame, hashes)
    assert all(s["route"] == ("relay" if route == "ws" else "rtc") for s in states[:3]), states
    result = {"game": game, "route": route, "players": 3, "spectators": 1, "checks": checks,
              "matchingFrame": int(frame), "hash": hashes[0], "final": states}
    for p in pages:
        p.context.close()
    setup.context.close()
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--th06-runtime", type=Path, required=True)
    parser.add_argument("--th07-runtime", type=Path, required=True)
    parser.add_argument("--channel", default="msedge")
    parser.add_argument("--route", choices=["ws", "rtc"], default="ws")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    Handler.runtimes = {"th06": args.th06_runtime.resolve(), "th07": args.th07_runtime.resolve()}
    Handler.workspace = args.workspace.resolve()
    # Build once from authored current code before starting any browser/server.
    Handler.keyboard_module = subprocess.run(
        ["node", "tests/support/bundle-runtime-keyboard.mjs"], cwd=ROOT,
        check=True, stdout=subprocess.PIPE,
    ).stdout
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = free_port()
    env = dict(os.environ, EAGLER_NETPLAY_RELAY_HOST="127.0.0.1", EAGLER_NETPLAY_RELAY_PORT=str(port),
               EAGLER_NETPLAY_STUN_URLS="")
    relay = subprocess.Popen(["node", "server/netplay-relay.mjs"], cwd=ROOT, env=env,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=.2):
                    break
            except OSError:
                time.sleep(.1)
        else:
            raise RuntimeError("private relay did not start")
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, channel=args.channel, args=[
                "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"])
            results = []
            for game in ["th06", "th07"]:
                print("RUN", game, args.route, flush=True)
                result = run_game(browser, f"http://127.0.0.1:{server.server_port}", f"ws://127.0.0.1:{port}", game, args.route)
                results.append(result)
                print("PASS", game, result["matchingFrame"], result["hash"], flush=True)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
            browser.close()
    finally:
        relay.terminate()
        relay.wait(timeout=10)
        server.shutdown()


if __name__ == "__main__":
    main()
