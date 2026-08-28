const port = Number.parseInt(process.argv[2] || "9237", 10);
const url = process.argv[3] || "https://test.touhou.vip/eagler-touhou/";
const expectedRevision = process.argv[4] || "5639ac90ab2caf22";
const endpoint = `http://127.0.0.1:${port}`;

const target = await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: "PUT" }).then(async response => {
  if (!response.ok) throw new Error(`cannot create Chrome target: HTTP ${response.status}`);
  return response.json();
});
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let serial = 0;
const pending = new Map();
const requests = new Map();
let capture = false;
ws.addEventListener("message", event => {
  const message = JSON.parse(String(event.data));
  if (message.id && pending.has(message.id)) {
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message || "CDP error"));
    else waiter.resolve(message.result);
    return;
  }
  if (!capture) return;
  if (message.method === "Network.requestWillBeSent") {
    requests.set(message.params.requestId, { url: message.params.request.url, status: null, encoded: 0 });
  } else if (message.method === "Network.responseReceived") {
    const item = requests.get(message.params.requestId);
    if (item) item.status = message.params.response.status;
  } else if (message.method === "Network.loadingFinished") {
    const item = requests.get(message.params.requestId);
    if (item) item.encoded = message.params.encodedDataLength || 0;
  }
});
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++serial;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "browser evaluation failed");
  return result.result?.value;
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  await cdp("Runtime.enable");
  await cdp("Page.enable");
  await cdp("Network.enable");
  await cdp("Network.setCacheDisabled", { cacheDisabled: true });
  const readyDeadline = Date.now() + 30000;
  while (Date.now() < readyDeadline) {
    if (await evaluate(`window.__eaglerBoot?.done === true && !!document.querySelector('[data-game="th07"]')`)) break;
    await delay(100);
  }
  if (!(await evaluate(`window.__eaglerBoot?.done === true`))) throw new Error("Launcher app did not initialize");
  await delay(1500);
  await evaluate(`
    localStorage.setItem("eagler-touhou-changelog-seen-20260822-1", "1");
    document.querySelector("#changelogDialog")?.close();
    document.querySelector('[data-game="th07"]').click();
    true;
  `);
  await evaluate(`document.getElementById("launch").click(); true`);

  const decisionDeadline = Date.now() + 15000;
  let decision = null;
  while (Date.now() < decisionDeadline) {
    decision = await evaluate(`({open:!!document.getElementById("decisionDialog")?.open,message:document.getElementById("decisionMessage")?.textContent||"",confirm:document.getElementById("decisionConfirm")?.textContent||""})`);
    if (decision.open) break;
    await delay(100);
  }
  if (!decision?.open || decision.confirm !== "立即更新" || !decision.message.includes("服务器有新版游戏资源")) {
    throw new Error(`sparse update decision did not open: ${JSON.stringify(decision)}`);
  }

  capture = true;
  await evaluate(`document.getElementById("decisionConfirm").click(); true`);
  const updateDeadline = Date.now() + 60000;
  let installation = null;
  while (Date.now() < updateDeadline) {
    installation = await evaluate(`(async()=>{
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open("eagler-touhou-package-store-v1");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
      try {
        const tx=db.transaction(["installations","generations"],"readonly");
        const current=await new Promise((resolve,reject)=>{const r=tx.objectStore("installations").get("th07");r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)});
        const generation=current?.currentGeneration ? await new Promise((resolve,reject)=>{const r=tx.objectStore("generations").get(["th07",current.currentGeneration]);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)}) : null;
        return {current,generation,status:document.getElementById("playerStatus")?.textContent||"",toast:document.getElementById("toast")?.textContent||""};
      } finally { db.close(); }
    })()`);
    if (installation?.generation?.descriptor?.revision === expectedRevision) break;
    await delay(150);
  }
  capture = false;
  if (installation?.generation?.descriptor?.revision !== expectedRevision) throw new Error(`sparse update did not commit: ${JSON.stringify(installation)}`);
  if (installation.current?.source !== "local") throw new Error(`local Package source was not preserved: ${installation.current?.source}`);

  await delay(500);
  const observed = [...requests.values()].filter(item => {
    const path = new URL(item.url).pathname;
    return path === "/th07.package.json" || path.startsWith("/games/") || path.startsWith("/shared/") || /\.(?:ogg|ttc|otf|data)$/.test(path);
  });
  const paths = observed.map(item => new URL(item.url).pathname);
  const expected = [
    "/th07.package.json",
    "/games/th07/multiplayer/th07.html",
    "/games/th07/multiplayer/th07.js",
    "/games/th07/multiplayer/th07.wasm",
  ];
  for (const path of expected) if (!paths.includes(path)) throw new Error(`missing sparse update request: ${path}; got ${paths.join(", ")}`);
  const forbidden = paths.filter(path => /\.(?:data|ogg|ttc|otf)$/.test(path) || (path.startsWith("/games/") && !expected.includes(path)));
  if (forbidden.length) throw new Error(`sparse update requested forbidden payloads: ${forbidden.join(", ")}`);
  if (observed.some(item => item.status !== 200)) throw new Error(`sparse update HTTP failure: ${JSON.stringify(observed)}`);
  const encodedBytes = observed.reduce((sum, item) => sum + item.encoded, 0);
  if (encodedBytes < 0.5 * 1024 * 1024 || encodedBytes > 4 * 1024 * 1024) {
    throw new Error(`sparse update transfer was outside the expected compressed 0.5-4 MiB range: ${encodedBytes}`);
  }
  console.log(JSON.stringify({ pass: true, revision: expectedRevision, source: installation.current.source, paths, encodedBytes }));
} finally {
  await cdp("Page.close").catch(() => {});
  try { ws.close(); } catch {}
}
