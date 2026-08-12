const port = process.argv[2] || "9222";
const targetUrl = process.argv[3] || "http://touhou.vip/eagler-touhou/";
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = targets.find(item => item.type === "page" && item.url.startsWith(targetUrl));
if (!target) throw new Error(`page not found: ${targetUrl}`);

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let serial = 0;
const pending = new Map();
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  message.error ? reject(new Error(message.error.message)) : resolve(message.result);
});
function send(method, params = {}) {
  const id = ++serial;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
await send("Runtime.enable");
for (const [game, promoted] of [["th06", false], ["th06", true], ["th07", false], ["th07", true]]) {
  await send("Page.reload", { ignoreCache: false });
  await delay(1500);
  const expression = `new Promise(resolve => {
    if (${promoted}) {
      const style = document.createElement("style");
      style.textContent = ".game:before{will-change:opacity,transform;backface-visibility:hidden;contain:paint}";
      document.head.append(style);
    }
    const gaps = [], longTasks = [];
    const observer = typeof PerformanceObserver === "function" ? new PerformanceObserver(list => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration);
    }) : null;
    try { observer && observer.observe({ type: "longtask", buffered: true }); } catch {}
    const started = performance.now(); let previous = started;
    function frame(now) {
      gaps.push(now - previous); previous = now;
      if (now - started < 1000) requestAnimationFrame(frame);
      else {
        observer && observer.disconnect();
        const sorted = [...gaps].sort((a, b) => a - b);
        resolve({ game: ${JSON.stringify(game)}, promoted: ${promoted}, frames: gaps.length,
          maxGap: Math.max(...gaps), p95: sorted[Math.floor(sorted.length * .95)] || 0,
          over32: gaps.filter(value => value > 32).length, longTasks });
      }
    }
    document.querySelector('[data-game=${game}]').click();
    requestAnimationFrame(frame);
  })`;
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(result.result.value));
}
socket.close();
