import fs from "node:fs/promises";

const selector = process.argv[2];
const output = process.argv[3];
const cdpPort = process.env.WEBVIEW_CDP_PORT || "9222";
if (!selector || !output) {
  throw new Error("Usage: node profile-webview.mjs <selector> <output.json>");
}

const targets = await fetch(`http://127.0.0.1:${cdpPort}/json`).then(response => response.json());
const target = targets.find(item => item.type === "page" && item.url.includes("eagler-touhou"));
if (!target) throw new Error("Eagler Touhou WebView target not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const eventWaiters = new Map();
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
    return;
  }
  const waiters = eventWaiters.get(message.method);
  if (!waiters?.length) return;
  eventWaiters.delete(message.method);
  for (const waiter of waiters) waiter(message.params);
});

function command(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

function once(method, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
    const resolveOnce = params => {
      clearTimeout(timeout);
      resolve(params);
    };
    eventWaiters.set(method, [...(eventWaiters.get(method) || []), resolveOnce]);
  });
}

await command("Page.enable");
await command("Runtime.enable");
await command("Performance.enable");
const loaded = once("Page.loadEventFired");
await command("Page.reload", { ignoreCache: true });
await loaded;
await new Promise(resolve => setTimeout(resolve, 1500));

const injectedCss = process.env.WEBVIEW_PROFILE_CSS || "";
const disableWaapi = process.env.WEBVIEW_DISABLE_WAAPI === "1";
if (injectedCss || disableWaapi) {
  await command("Runtime.evaluate", {
    expression: `(() => {
      const css = ${JSON.stringify(injectedCss)};
      if (css) {
        const style = document.createElement("style");
        style.dataset.webviewProfile = "true";
        style.textContent = css;
        document.head.append(style);
      }
      if (${JSON.stringify(disableWaapi)}) {
        Element.prototype.animate = function () { return { cancel() {}, finish() {} }; };
      }
    })()`
  });
}

await command("Tracing.start", {
  categories: "devtools.timeline,blink,cc,v8",
  options: "record-as-much-as-possible",
  transferMode: "ReturnAsStream"
});

const before = await command("Performance.getMetrics");
const expression = `new Promise(resolve => {
  const selector = ${JSON.stringify(selector)};
  const target = document.querySelector(selector);
  if (!target) { resolve({ error: "selector not found", selector }); return; }
  const started = performance.now();
  const gaps = [];
  const longTasks = [];
  let last = started;
  let observer;
  try {
    observer = new PerformanceObserver(list => {
      for (const item of list.getEntries()) longTasks.push({ start: item.startTime, duration: item.duration });
    });
    observer.observe({ type: "longtask", buffered: true });
  } catch {}
  function frame(now) {
    gaps.push(now - last);
    last = now;
    if (now - started < 2500) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  target.click();
  setTimeout(() => {
    observer?.disconnect();
    const sorted = gaps.slice().sort((a, b) => b - a);
    resolve({ selector, sampleMs: performance.now() - started, frameCount: gaps.length,
      maxFrameGapMs: sorted[0] || 0, p95FrameGapMs: sorted[Math.floor(sorted.length * 0.05)] || 0,
      over50ms: gaps.filter(value => value > 50).length, over100ms: gaps.filter(value => value > 100).length,
      longTasks });
  }, 2600);
})`;
const evaluated = await command("Runtime.evaluate", {
  expression,
  awaitPromise: true,
  returnByValue: true
});
const after = await command("Performance.getMetrics");

const completed = once("Tracing.tracingComplete", 30000);
await command("Tracing.end");
const { stream } = await completed;
let trace = "";
for (;;) {
  const part = await command("IO.read", { handle: stream });
  trace += part.base64Encoded ? Buffer.from(part.data, "base64").toString("utf8") : part.data;
  if (part.eof) break;
}
await command("IO.close", { handle: stream });

const metrics = Object.fromEntries(before.metrics.map(item => [item.name, {
  before: item.value,
  after: after.metrics.find(candidate => candidate.name === item.name)?.value
}]));
const traceObject = JSON.parse(trace);
traceObject.webviewLab = {
  target: { title: target.title, url: target.url },
  result: evaluated.result.value,
  metrics
};
await fs.writeFile(output, JSON.stringify(traceObject));
console.log(JSON.stringify(traceObject.webviewLab, null, 2));
socket.close();
