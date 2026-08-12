const targets = await fetch("http://127.0.0.1:9222/json").then(r => r.json());
const target = targets.find(item => item.type === "page" && item.url.includes("/eagler-touhou/"));
if (!target) throw new Error("eagler-touhou target not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;

socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

function command(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

await command("Runtime.enable");
await command("Performance.enable");

const scenario = process.argv[2] || "mobile-options";
const expression = String.raw`(async () => {
  const scenario = ${JSON.stringify(scenario)};
  const toggle = document.querySelector('#mobileOptionsToggle');
  const panel = document.querySelector('#mobileOptions');
  const body = document.querySelector('#mobileOptionsBody');
  if (!toggle || !panel || !body) throw new Error('mobile options UI missing');
  if (panel.classList.contains('open')) toggle.click();
  await new Promise(resolve => setTimeout(resolve, 400));

  const frames = [];
  const longTasks = [];
  const shifts = [];
  const observers = [];
  try {
    const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration }))));
    observer.observe({ type: 'longtask' });
    observers.push(observer);
  } catch {}
  try {
    const observer = new PerformanceObserver(list => shifts.push(...list.getEntries().filter(e => !e.hadRecentInput).map(e => ({ start: e.startTime, value: e.value }))));
    observer.observe({ type: 'layout-shift' });
    observers.push(observer);
  } catch {}

  let previous = performance.now();
  const begin = previous;
  if (scenario === 'card') {
    const cards = [...document.querySelectorAll('.game')];
    const target = cards.find(card => !card.classList.contains('selected')) || cards[0];
    target.click();
  } else {
    toggle.click();
  }
  await new Promise(resolve => {
    const tick = now => {
      frames.push(now - previous);
      previous = now;
      if (now - begin < 1400) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  observers.forEach(observer => observer.disconnect());
  const sorted = [...frames].sort((a, b) => a - b);
  const percentile = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const bodyStyle = getComputedStyle(body);
  const panelStyle = getComputedStyle(panel);
  return {
    scenario,
    userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    frames: frames.length,
    meanMs: frames.reduce((a, b) => a + b, 0) / frames.length,
    p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), maxMs: sorted.at(-1),
    over20ms: frames.filter(value => value > 20).length,
    over40ms: frames.filter(value => value > 40).length,
    longTasks,
    layoutShiftTotal: shifts.reduce((sum, item) => sum + item.value, 0),
    shifts,
    css: {
      bodyTransition: bodyStyle.transition,
      bodyMaxHeight: bodyStyle.maxHeight,
      bodyContain: bodyStyle.contain,
      panelHeight: panelStyle.height
    }
  };
})()`;

const result = await command("Runtime.evaluate", {
  expression,
  awaitPromise: true,
  returnByValue: true,
  userGesture: true
});
if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
console.log(JSON.stringify(result.result.value, null, 2));
socket.close();
