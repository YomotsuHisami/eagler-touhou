const port = Number.parseInt(process.argv[2] || "9224", 10);
const url = process.argv[3] || "http://127.0.0.1:8140/eagler-touhou/";
const mode = process.argv[4] || "package";
const game = process.argv[5] || "th06";
const reuseExisting = process.argv[6] === "reuse";
const music = process.argv[7] || "";
const skipStorageClear = process.argv[8] === "noclear";
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid Chrome debugging port");
if (!new Set(["package", "local-package", "legacy"]).has(mode)) throw new Error("invalid browser test mode");
if (!/^th\d{2}$/.test(game)) throw new Error("invalid game id");
if (music && !new Set(["midi", "ogg-stream", "ogg-full", "none"]).has(music)) throw new Error("invalid music mode");

const endpoint = `http://127.0.0.1:${port}`;
const origin = new URL(url).origin;
let createdTarget = false;
const target = reuseExisting
  ? await fetch(`${endpoint}/json/list`).then(async response => {
      if (!response.ok) throw new Error(`cannot list Chrome targets: HTTP ${response.status}`);
      const targets = await response.json();
      const page = targets.find(item => item.type === "page" && item.webSocketDebuggerUrl);
      if (!page) throw new Error("Chrome has no reusable page target");
      return page;
    })
  : await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: "PUT" }).then(async response => {
      if (!response.ok) throw new Error(`cannot create Chrome target: HTTP ${response.status}`);
      createdTarget = true;
      return response.json();
    });
if (!target.webSocketDebuggerUrl) throw new Error("Chrome target has no WebSocket debugger URL");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
let serial = 0;
const pending = new Map();
ws.addEventListener("message", event => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) return;
  const waiter = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message || "CDP error"));
  else waiter.resolve(message.result);
});
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++serial;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.exception?.value || result.exceptionDetails.text;
    throw new Error(detail || "browser evaluation failed");
  }
  return result.result?.value;
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  await cdp("Runtime.enable");
  await cdp("Page.enable");
  if (reuseExisting) {
    await cdp("Page.navigate", { url });
    await delay(300);
  }
  if (!skipStorageClear) await cdp("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
  await cdp("Page.reload", { ignoreCache: true });

  const readyDeadline = Date.now() + 20000;
  while (Date.now() < readyDeadline) {
    const ready = await evaluate(`document.readyState === "complete" && window.__eaglerBoot?.done === true && !!document.getElementById("launch") && !!document.querySelector('[data-game=${JSON.stringify(game)}]')`);
    if (ready) break;
    await delay(100);
  }
  if (!(await evaluate(`window.__eaglerBoot?.done === true`))) {
    throw new Error(`Launcher app did not finish initialization: ${await evaluate(`JSON.stringify(window.__eaglerBoot || {})`)}`);
  }
  await evaluate(`localStorage.setItem("eagler-touhou-changelog-seen-20260822-1", "1"); document.querySelector("#changelogDialog")?.close();`);
  await evaluate(`window.__launcherFirstFrame = false; window.__sawNetworkTransfer = false; window.addEventListener("message", event => { const m = event.data || {}; if (m.protocol === "eagler-touhou/1" && m.game === ${JSON.stringify(game)} && m.event === "first-frame") window.__launcherFirstFrame = true; }); true`);
  await evaluate(`document.querySelector('[data-game=${JSON.stringify(game)}]').click(); true`);
  if (music) {
    await evaluate(`(()=>{ const select=document.getElementById("musicSelect"); if(!select) throw new Error("musicSelect missing"); select.value=${JSON.stringify(music)}; select.dispatchEvent(new Event("change",{bubbles:true})); return select.value; })()`);
  }
  await evaluate(`document.getElementById("launch").click(); true`);
  // Touch-capable Android browsers/WebViews legitimately show the product's
  // "no touch controls" confirmation before launch. Desktop Chromium does not
  // hit this branch, so the cross-browser E2E must accept it explicitly rather
  // than waiting forever with a selected game and no Player frame.
  await delay(50);
  await evaluate(`(()=>{
    const dialog = document.getElementById("decisionDialog");
    if (!dialog?.open) return false;
    const confirm = document.getElementById("decisionConfirm");
    if (!confirm) throw new Error("launch confirmation button missing");
    confirm.click();
    return true;
  })()`);

  const deadline = Date.now() + 120000;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(`(async()=>{
      const status = document.getElementById("playerStatus")?.textContent || "";
      const hostStatus = document.getElementById("status")?.textContent || "";
      const startupError = document.getElementById("startupErrorText")?.textContent || "";
      const importReason = document.getElementById("gameDataImportReason")?.textContent || "";
      const toast = document.getElementById("toast")?.textContent || "";
      const frame = document.getElementById("gameFrame");
      const transfer = document.getElementById("transfer");
      if (transfer && !transfer.hidden && transfer.dataset.networkActive === "1") window.__sawNetworkTransfer = true;
      let installation = null;
      const known = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
      if (known.some(item => item.name === "eagler-touhou-package-store-v1")) {
        const db = await new Promise((resolve,reject)=>{const r=indexedDB.open("eagler-touhou-package-store-v1");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
        try {
          if (db.objectStoreNames.contains("installations")) {
            installation = await new Promise((resolve,reject)=>{const tx=db.transaction(["installations"],"readonly");const r=tx.objectStore("installations").get(${JSON.stringify(game)});r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)});
          }
        } finally { db.close(); }
      }
      return {status, hostStatus, startupError, importReason, toast, firstFrame: window.__launcherFirstFrame === true, sawNetworkTransfer: window.__sawNetworkTransfer === true, transferLabel: document.getElementById("transferLabel")?.textContent || "", frameSrc: frame?.src || "", installation, playerOpen: document.getElementById("player")?.classList.contains("open") || false};
    })()`);
    if (mode === "package") {
      if (last?.installation?.currentGeneration && /player\.html\?/.test(last.frameSrc) && last.status === "运行中" && last.firstFrame) {
        if (last.installation.source !== "remote") throw new Error(`first remote install source mismatch: ${last.installation.source}`);
        if (!last.sawNetworkTransfer) throw new Error(`Package install never exposed foreground network activity: ${JSON.stringify(last)}`);
        console.log(`Launcher first-install Chromium: PASS (${last.installation.currentGeneration})`);
        process.exitCode = 0;
        break;
      }
    } else if (mode === "local-package" && last?.installation?.currentGeneration &&
        new RegExp(`/runtime/${game}/${game}\\.html`).test(last.frameSrc) && last.status === "运行中" && last.firstFrame) {
      if (last.installation.source !== "local") throw new Error(`local package source mismatch: ${last.installation.source}`);
      console.log(`Launcher local-package Chromium: PASS (${last.installation.currentGeneration})`);
      process.exitCode = 0;
      break;
    } else if (new RegExp(`/games/${game}/${game}\\.html`).test(last.frameSrc) && last.status === "运行中" && last.firstFrame) {
      console.log("Launcher legacy hosted Chromium: PASS");
      process.exitCode = 0;
      break;
    }
    if (/失败|错误|超时|不可用|需要导入|not defined|ReferenceError|TypeError|Error:/i.test(`${last?.status || ""}\n${last?.hostStatus || ""}\n${last?.startupError || ""}`)) throw new Error(`Launcher failed: ${JSON.stringify(last)}`);
    await delay(250);
  }
  if (process.exitCode == null) throw new Error(`Launcher first-install timed out: ${JSON.stringify(last)}`);
} finally {
  if (createdTarget) await cdp("Page.close").catch(() => {});
  try { ws.close(); } catch {}
}
