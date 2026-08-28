import { resolve } from "node:path";

const port = Number.parseInt(process.argv[2] || "9224", 10);
const url = process.argv[3] || "http://127.0.0.1:8140/eagler-touhou/";
const zipPath = resolve(process.argv[4] || "../archive/temporary/th06-launcher-import-e2e.zip");
const game = process.argv[5] || "th06";
if (!/^th\d{2}$/.test(game)) throw new Error("invalid game id");
const endpoint = `http://127.0.0.1:${port}`;
const origin = new URL(url).origin;

const target = await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: "PUT" }).then(async response => {
  if (!response.ok) throw new Error(`cannot create Chrome target: HTTP ${response.status}`);
  return response.json();
});
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveOpen, reject) => {
  ws.addEventListener("open", resolveOpen, { once: true });
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
const cdp = (method, params = {}) => new Promise((resolveCall, reject) => {
  const id = ++serial;
  pending.set(id, { resolve: resolveCall, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "browser evaluation failed");
  return result.result?.value;
};
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

try {
  await cdp("Runtime.enable");
  await cdp("Page.enable");
  await cdp("Network.enable");
  await cdp("DOM.enable");
  await cdp("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
  await cdp("Page.reload", { ignoreCache: true });

  const readyDeadline = Date.now() + 20000;
  while (Date.now() < readyDeadline) {
    if (await evaluate(`window.__eaglerBoot?.done === true && !!document.querySelector('[data-game=${JSON.stringify(game)}]')`)) break;
    await delay(100);
  }
  if (!(await evaluate(`window.__eaglerBoot?.done === true`))) throw new Error("Launcher app did not initialize");

  await evaluate(`
    localStorage.setItem("eagler-touhou-changelog-seen-20260822-1", "1");
    document.querySelector("#changelogDialog")?.close();
    window.__packageImportFirstFrameSeen = false;
    window.addEventListener("message", e => { if (e.data?.protocol === "eagler-touhou/1" && e.data?.game === ${JSON.stringify(game)} && e.data?.event === "first-frame") window.__packageImportFirstFrameSeen = true; });
    document.querySelector('[data-game=${JSON.stringify(game)}]').click();
    const music = document.getElementById("musicSelect");
    music.value = "midi";
    music.dispatchEvent(new Event("change", { bubbles: true }));
    true;
  `);

  await cdp("Network.setBlockedURLs", { urls: [`*${game}.data*`] });
  await evaluate(`document.getElementById("launch").click(); true`);

  const importDeadline = Date.now() + 45000;
  while (Date.now() < importDeadline) {
    const state = await evaluate(`({
      hidden: document.getElementById("gameDataImportWindow")?.hidden,
      reason: document.getElementById("gameDataImportReason")?.textContent || "",
      status: document.getElementById("status")?.textContent || ""
    })`);
    if (state.hidden === false) break;
    await delay(150);
  }
  if (await evaluate(`document.getElementById("gameDataImportWindow")?.hidden !== false`)) {
    throw new Error(`Import UI did not open: ${await evaluate(`document.getElementById("status")?.textContent || ""`)}`);
  }

  const root = await cdp("DOM.getDocument", { depth: -1, pierce: true });
  const input = await cdp("DOM.querySelector", { nodeId: root.root.nodeId, selector: "#gameDataImportInput" });
  if (!input.nodeId) throw new Error("gameDataImportInput not found");
  await cdp("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [zipPath] });
  await evaluate(`document.getElementById("gameDataImportInput").dispatchEvent(new Event("change", { bubbles: true })); true`);

  const deadline = Date.now() + 120000;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(`(async()=>{
      const db = await new Promise((resolveDb,reject)=>{const r=indexedDB.open("eagler-touhou-package-store-v1");r.onsuccess=()=>resolveDb(r.result);r.onerror=()=>reject(r.error)});
      let installation = null;
      try {
        if (db.objectStoreNames.contains("installations")) installation = await new Promise((resolveGet,reject)=>{const tx=db.transaction(["installations"],"readonly");const r=tx.objectStore("installations").get(${JSON.stringify(game)});r.onsuccess=()=>resolveGet(r.result||null);r.onerror=()=>reject(r.error)});
      } finally { db.close(); }
      return {
        status: document.getElementById("playerStatus")?.textContent || "",
        hostStatus: document.getElementById("status")?.textContent || "",
        firstFrame: !!window.__packageImportFirstFrameSeen,
        frameSrc: document.getElementById("gameFrame")?.src || "",
        installation,
        playerOpen: document.getElementById("player")?.classList.contains("open") || false
      };
    })()`);
    if (last?.installation?.source === "local" && last.installation.currentGeneration && !last.playerOpen &&
        last.hostStatus.includes("游戏包已导入，可以启动游戏")) {
      console.log(`Launcher ZIP-import Chromium: PASS, explicit second launch required (${last.installation.currentGeneration})`);
      process.exitCode = 0;
      break;
    }
    if (/错误|超时|ReferenceError|TypeError|Error:/i.test(`${last?.status || ""}\n${last?.hostStatus || ""}`)) {
      throw new Error(`Launcher ZIP import failed: ${JSON.stringify(last)}`);
    }
    await delay(200);
  }
  if (process.exitCode == null) throw new Error(`Launcher ZIP import timed out: ${JSON.stringify(last)}`);
} finally {
  await cdp("Network.setBlockedURLs", { urls: [] }).catch(() => {});
  await cdp("Page.close").catch(() => {});
}
