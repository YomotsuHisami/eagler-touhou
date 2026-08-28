import { execFileSync } from "node:child_process";

const devtoolsUrl = process.argv[2] || "http://127.0.0.1:9227/json";
const baseUrl = process.argv[3] || "http://127.0.0.1:8136/eagler-touhou/";
const adbPath = process.argv[4] || "D:\\Android\\Sdk\\platform-tools\\adb.exe";
const adbSerial = process.argv[5] || "emulator-5556";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect() {
  const targets = await fetch(devtoolsUrl).then(response => response.json());
  const target = targets.find(item => item.type === "page" && item.webSocketDebuggerUrl);
  if (!target) throw new Error("Android WebView DevTools page target not found");
  let targetBounds = {};
  try { targetBounds = JSON.parse(target.description || "{}"); } catch {}
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message || JSON.stringify(message.error)));
    else waiter.resolve(message.result || {});
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
    return result.result?.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  return { socket, send, evaluate, targetBounds };
}

async function waitEval(cdp, expression, predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await cdp.evaluate(expression);
      if (predicate(last)) return last;
    } catch {}
    await sleep(100);
  }
  throw new Error(`condition timeout; last=${JSON.stringify(last)}`);
}

async function trustedTap(cdp, selector) {
  if (selector === "#launch") {
    for (let attempt = 0; attempt < 8; attempt++) {
      execFileSync(adbPath, ["-s", adbSerial, "shell", "uiautomator", "dump", "/sdcard/window.xml"], { stdio: "ignore" });
      const xml = execFileSync(adbPath, ["-s", adbSerial, "shell", "cat", "/sdcard/window.xml"], { encoding: "utf8" });
      const match = xml.match(/text="启动游戏"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
      if (match) {
        const [, x1, y1, x2, y2] = match.map(Number);
        if (x2 > x1 && y2 > y1) {
          execFileSync(adbPath, ["-s", adbSerial, "shell", "input", "tap",
            String(Math.round((x1 + x2) / 2)), String(Math.round((y1 + y2) / 2))], { stdio: "ignore" });
          return;
        }
      }
      // Bring the bottom launch action into the real Android viewport. This
      // deliberately uses OS input instead of DOM scrolling so accessibility
      // bounds and the physical tap target stay in agreement.
      execFileSync(adbPath, ["-s", adbSerial, "shell", "input", "swipe", "540", "2050", "540", "500", "250"], { stdio: "ignore" });
      await sleep(200);
    }
    throw new Error("Android launch button never became visible");
  }
  const rect = await cdp.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      width: rect.width,
      height: rect.height,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      dpr: window.devicePixelRatio || 1
    };
  })()`);
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) throw new Error(`cannot tap ${selector}`);
  // WebView's CDP Input domain does not reliably synthesize DOM clicks. Use
  // an actual Android input tap instead. Target bounds are physical pixels;
  // DOM rects are CSS pixels, so derive the scale from the live WebView size.
  const bounds = cdp.targetBounds || {};
  const scaleX = Number(bounds.width) > 0 && rect.innerWidth > 0 ? Number(bounds.width) / rect.innerWidth : rect.dpr;
  const scaleY = Number(bounds.height) > 0 && rect.innerHeight > 0 ? Number(bounds.height) / rect.innerHeight : rect.dpr;
  const x = Math.round((Number(bounds.screenX) || 0) + rect.x * scaleX);
  const y = Math.round((Number(bounds.screenY) || 0) + rect.y * scaleY);
  execFileSync(adbPath, ["-s", adbSerial, "shell", "input", "tap", String(x), String(y)], { stdio: "ignore" });
}

async function runGame(cdp, game) {
  const runUrl = new URL(baseUrl);
  runUrl.searchParams.set("test", `android-focus-${game}-${Date.now()}`);

  await cdp.evaluate(`(() => {
    const game = ${JSON.stringify(game)};
    const key = 'eagler-touhou-game-options-v1-' + game;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch {}
    saved.music = 'none';
    saved.options = {
      ...(saved.options || {}),
      touchEnabled: true,
      touchMovementMode: 'touch',
      touchFocusMode: 'hold-button'
    };
    localStorage.setItem(key, JSON.stringify(saved));
    localStorage.setItem('eagler-touhou-changelog-seen-20260822-1', '1');
    location.href = ${JSON.stringify(runUrl.href)};
  })()`);

  await waitEval(cdp,
    `(() => !!window.__eaglerBoot?.done && !!document.getElementById('launch'))()`,
    value => value === true,
    30000);

  await cdp.evaluate(`(() => {
    document.querySelector('#changelogDialog')?.close();
    document.querySelector('[data-game=${JSON.stringify(game)}]')?.click();
    const music = document.getElementById('musicSelect');
    if (music) {
      music.value = 'none';
      music.dispatchEvent(new Event('change', { bubbles: true }));
    }
    window.__androidFocusFirstFrame = false;
    window.__androidFocusFirstFrameAt = 0;
    window.addEventListener('message', event => {
      const message = event.data || {};
      if (message.protocol === 'eagler-touhou/1' && message.event === 'first-frame') {
        window.__androidFocusFirstFrame = true;
        window.__androidFocusFirstFrameAt = performance.now();
      }
    });
  })()`);

  const startedAt = Date.now();
  await trustedTap(cdp, "#launch");
  const running = await waitEval(cdp,
    `(() => ({
      firstFrame: window.__androidFocusFirstFrame === true,
      status: document.getElementById('playerStatus')?.textContent || '',
      startupError: document.getElementById('startupErrorText')?.textContent || '',
      directHidden: document.getElementById('touchDirectSurface')?.hidden,
      touchEnabled: document.getElementById('player')?.classList.contains('touch-enabled') || false,
      frameSrc: document.getElementById('gameFrame')?.src || ''
    }))()`,
    value => value?.firstFrame === true || !!value?.startupError,
    30000);

  if (!running.firstFrame) throw new Error(`${game}: first-frame failed: ${running.startupError || running.status}`);
  if (running.directHidden !== true) throw new Error(`${game}: Android unexpectedly enabled iOS direct-touch overlay`);
  if (!running.touchEnabled) throw new Error(`${game}: test did not launch with touch enabled`);

  const exitStartedAt = Date.now();
  const exitInjected = await cdp.evaluate(`(() => {
    const playerFrame = document.getElementById('gameFrame');
    const runtimeFrame = playerFrame?.contentDocument?.getElementById('runtime');
    const fn = runtimeFrame?.contentWindow?.EaglerTouhouGameExited;
    if (typeof fn !== 'function') return false;
    fn(1);
    return true;
  })()`);
  if (!exitInjected) throw new Error(`${game}: could not inject Runtime exit event`);
  await waitEval(cdp,
    `(() => !document.getElementById('player')?.classList.contains('open'))()`,
    value => value === true,
    3000);
  const exitCloseMs = Date.now() - exitStartedAt;
  if (exitCloseMs >= 2500) throw new Error(`${game}: post-exit Player close remained stalled (${exitCloseMs} ms)`);

  return {
    game,
    touchEnabled: true,
    firstFrameWithoutExtraTap: true,
    startupMs: Date.now() - startedAt,
    directTouchOverlayOnAndroid: false,
    exitCloseMs,
    status: running.status
  };
}

const cdp = await connect();
try {
  const results = [];
  for (const game of ["th06", "th07"]) results.push(await runGame(cdp, game));
  console.log("Android WebView touch-focus smoke: PASS " + JSON.stringify(results));
} finally {
  cdp.socket.close();
}
