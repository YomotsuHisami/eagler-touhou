import assert from "node:assert/strict";
import { ContentNode, ContentDocument } from "./content-dom.mjs";
import {
  FIRST_USE_NOTICE_FILE,
  FIRST_USE_NOTICE_SEEN_STORAGE_KEY,
  createFirstUseNoticeController,
} from "../.cache/build/browser/assets/launcher/first-use-notice.mjs";

class FakeElement extends ContentNode {
  constructor(id = "") { super("div"); this.id = id; }
  open = false;
  showCount = 0;
  closeCount = 0;
  classList = { values: new Set(), add: (...names) => names.forEach(name => this.classList.values.add(name)), remove: (...names) => names.forEach(name => this.classList.values.delete(name)) };
  listeners = new Map();
  querySelectorAll() { return []; }
  addEventListener(type, callback) { this.listeners.set(type, [...(this.listeners.get(type) || []), callback]); }
  showModal() { this.open = true; this.showCount++; }
  close() { this.open = false; this.closeCount++; }
}

class FakeDocument extends ContentDocument {
  constructor() {
    super();
    this.elements = new Map([
      ["firstUseNoticeDialog", new FakeElement("firstUseNoticeDialog")],
      ["firstUseNoticeText", new FakeElement("firstUseNoticeText")],
    ]);
  }
  getElementById(id) { return this.elements.get(id) || null; }
}

function storageFrom(values = new Map()) {
  return {
    values,
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function response(text, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

const noticeHtml = '<div class="first-use-notice-list"><section class="first-use-notice-item"><h2>开始前请注意</h2><p>Item</p></section></div>';
const sharedStorage = storageFrom();
const firstDocument = new FakeDocument();
const first = createFirstUseNoticeController({
  documentObj: firstDocument,
  storage: sharedStorage,
  fetchImpl: async path => {
    assert.equal(path, FIRST_USE_NOTICE_FILE);
    return response(noticeHtml);
  },
  matchMediaImpl: () => ({ matches: true }),
});
assert.equal(await first.maybeShowAutomatically(), true, "a new browser must see the first-use notice once");
assert.equal(firstDocument.getElementById("firstUseNoticeDialog").showCount, 1);
assert.equal(firstDocument.getElementById("firstUseNoticeText").innerHTML, noticeHtml);
assert.equal(sharedStorage.values.get(FIRST_USE_NOTICE_SEEN_STORAGE_KEY), "1");
first.close();
assert.equal(firstDocument.getElementById("firstUseNoticeDialog").closeCount, 1, "reduced-motion close finishes immediately");

let returningFetches = 0;
const returningDocument = new FakeDocument();
const returning = createFirstUseNoticeController({
  documentObj: returningDocument,
  storage: sharedStorage,
  fetchImpl: async () => { returningFetches++; return response(noticeHtml.replace("Item", "Changed")); },
});
assert.equal(await returning.maybeShowAutomatically(), false,
  "content changes must not interrupt a player who has completed first-use onboarding");
assert.equal(returningFetches, 0, "returning-player startup need not fetch the notice just to decide whether to show it");
assert.equal(returningDocument.getElementById("firstUseNoticeDialog").showCount, 0);

for (const legacyKey of [
  "eagler-touhou-new-player-notice-seen-v1",
  "eagler-touhou-changelog-seen-v2",
  "eagler-touhou-changelog-seen-20260822-1",
]) {
  const legacyStorage = storageFrom(new Map([[legacyKey, "legacy-seen"]]));
  const legacy = createFirstUseNoticeController({
    documentObj: new FakeDocument(),
    storage: legacyStorage,
    fetchImpl: async () => { throw new Error("legacy seen state should suppress fetch"); },
  });
  assert.equal(await legacy.maybeShowAutomatically(), false, `${legacyKey} must migrate as already onboarded`);
  assert.equal(legacyStorage.values.get(FIRST_USE_NOTICE_SEEN_STORAGE_KEY), "1");
}

const emptyDocument = new FakeDocument();
const empty = createFirstUseNoticeController({
  documentObj: emptyDocument,
  storage: storageFrom(),
  fetchImpl: async () => response("\n\r\n"),
  emptyText: () => "EMPTY",
});
assert.equal(await empty.maybeShowAutomatically(), false, "an empty packaged notice is a valid non-interrupting state");
assert.equal(emptyDocument.getElementById("firstUseNoticeDialog").showCount, 0);
const emptyResult = await empty.showManual();
assert.equal(emptyResult.kind, "empty");
assert.equal(emptyDocument.getElementById("firstUseNoticeDialog").showCount, 1,
  "manual notice entry remains usable when source content is empty");
assert.equal(emptyDocument.getElementById("firstUseNoticeText").children[0]?.textContent, "EMPTY");

const reopenDocument = new FakeDocument();
let delayedClose;
const reopen = createFirstUseNoticeController({
  documentObj: reopenDocument,
  storage: storageFrom(),
  fetchImpl: async () => response(noticeHtml),
  setTimeoutImpl: callback => { delayedClose = callback; return 1; },
});
await reopen.showManual();
reopen.close();
await reopen.showManual();
delayedClose();
assert.equal(reopenDocument.getElementById("firstUseNoticeDialog").open, true,
  "reopening during the close animation must cancel the stale close completion");

const failedDocument = new FakeDocument();
const failed = createFirstUseNoticeController({
  documentObj: failedDocument,
  storage: storageFrom(),
  fetchImpl: async () => { throw new Error("offline"); },
  readFailureText: error => `FAILED:${error.message}`,
});
assert.equal(await failed.maybeShowAutomatically(), false, "fetch failure must never interrupt Launcher startup");
assert.equal(failedDocument.getElementById("firstUseNoticeDialog").showCount, 0);
const failedResult = await failed.showManual();
assert.equal(failedResult.kind, "error");
assert.equal(failedDocument.getElementById("firstUseNoticeDialog").showCount, 1);
assert.equal(failedDocument.getElementById("firstUseNoticeText").children[0]?.textContent, "FAILED:offline");

console.log(JSON.stringify({ firstUseNotice: "PASS", source: FIRST_USE_NOTICE_FILE, autoShow: "once-per-browser", legacySeenMigration: true }));
