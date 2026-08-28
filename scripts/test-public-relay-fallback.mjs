const base = new URL(process.argv[2] || "wss://test.touhou.vip/eagler-netplay/");
const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
base.searchParams.set("room", `fallback-${nonce}`);
base.searchParams.set("run", "1");
base.searchParams.set("players", "2");

const sockets = [];
const open = (player, signal = false) => new Promise((resolve, reject) => {
  const url = new URL(base);
  url.searchParams.set("player", String(player));
  if (signal) url.searchParams.set("signal", "1");
  const socket = new WebSocket(url);
  sockets.push(socket);
  const timer = setTimeout(() => reject(new Error(`open timeout: P${player + 1}${signal ? " signal" : " relay"}`)), 5000);
  socket.addEventListener("open", () => { clearTimeout(timer); resolve(socket); }, { once: true });
  socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error(`socket error: ${url.pathname}`)); }, { once: true });
});
const route = socket => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("public relay fallback timeout")), 8000);
  socket.addEventListener("message", event => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (message.type !== "route") return;
    clearTimeout(timer);
    resolve(message.mode);
  });
});

try {
  const relay0 = await open(0);
  const relay1 = await open(1);
  const started = performance.now();
  const routes = [route(relay0), route(relay1)];
  await open(0, true); // P2 signaling is deliberately absent.
  const modes = await Promise.all(routes);
  const elapsedMs = Math.round(performance.now() - started);
  if (modes.some(mode => mode !== "relay") || elapsedMs > 7000) throw new Error(`unexpected route ${modes.join(",")} after ${elapsedMs}ms`);
  console.log(JSON.stringify({ pass: true, modes, elapsedMs }));
} finally {
  for (const socket of sockets) try { socket.close(); } catch {}
}
