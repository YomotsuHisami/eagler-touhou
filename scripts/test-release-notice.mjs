import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const html = read("index.html");
const app = read("app.js");
const changelog = read("CHANGELOG.txt");
const shells = [read("../th06-eagler/resources/shell.html"), read("../th07-eagler/resources/shell.html")];

const requireText = (source, needle, label) => {
  if (!source.includes(needle)) throw new Error(`missing ${label}: ${needle}`);
};

for (const [needle, label] of [
  ['id="frameLimitHint"', "frame-limit hint"],
  ['id="changelogOpen"', "manual changelog entry"],
  ['id="changelogDialog"', "changelog dialog"],
  ['id="changelogConfirm"', "changelog acknowledgement"],
  ['id="changelogText"', "plain-text changelog viewer"],
  ["CHANGELOG.txt", "plain-text changelog label"],
]) requireText(html, needle, label);

for (const [needle, label] of [
  ["修复 松开第二根手指后持续低速的问题", "touch release changelog item"],
  ["优化 移动端帧率调度", "mobile frame pacing changelog item"],
  ["调整 移动端强制锁定 60 帧", "mobile forced 60 changelog item"],
  ["此前版本没有维护正式的 CHANGELOG.txt", "historical changelog boundary"],
]) requireText(changelog, needle, label);

for (const [needle, label] of [
  ['const changelogVersion = "20260817-1";', "versioned changelog"],
  ['fetch("CHANGELOG.txt", { cache: "no-store" })', "real changelog text fetch"],
  ['if (mobileDevice) options.limitPresentationTo60 = true;', "mobile forced 60 restore"],
  ['if (mobileDevice && name === "limitPresentationTo60")', "mobile forced 60 mutation guard"],
  ['frameLimitToggle.disabled = mobileDevice;', "mobile frame switch disable"],
  ['由于调度问题，移动端设备强制锁定 60 帧', "mobile scheduling notice"],
  ['localStorage.setItem(changelogSeenKey, "1")', "one-time seen marker"],
  ['localStorage.getItem(changelogSeenKey) === "1"', "one-time seen check"],
  ['if (!changelogSeen && !debugHarness && !touchPreview) void showChangelog(true);', "one-time auto show on normal user paths"],
  ['$("#changelogOpen").addEventListener("click", () => { void showChangelog(false); });', "manual reopen"],
]) requireText(app, needle, label);

requireText(html, 'app.js?v=20260817-1', "host script cache key for current changelog release");

for (const [needle, label] of [
  ["修复 触控状态异常后无法移动的问题", "touch movement recovery changelog entry"],
  ["修复 ESC 菜单双指操作后点击失效的问题", "pause menu click changelog entry"],
  ["修复 ESC 菜单双指操作后滑动失效的问题", "pause menu swipe changelog entry"],
  ["修复 Web 运行时新旧缓存混用导致的异常", "runtime cache changelog entry"],
]) requireText(changelog, needle, label);

for (const [index, shell] of shells.entries()) {
  requireText(shell, "const mobileDevice = navigator.userAgentData?.mobile === true", `TH0${index + 6} shell mobile detection`);
  requireText(shell, "limitPresentationTo60: mobileDevice || !!options.limitPresentationTo60", `TH0${index + 6} hosted mobile force`);
  requireText(shell, "limitPresentationTo60: mobileDevice", `TH0${index + 6} standalone mobile force`);
}

const showStart = app.indexOf("async function showChangelog(automatic = false)");
const closeStart = app.indexOf("function closeChangelog()", showStart);
if (showStart < 0 || closeStart < 0) throw new Error("changelog function bounds missing");
const showBody = app.slice(showStart, closeStart);
if (showBody.indexOf("dialog.showModal();") > showBody.indexOf('localStorage.setItem(changelogSeenKey, "1")')) {
  throw new Error("automatic changelog must be marked seen immediately after successful showModal");
}
if (!showBody.includes("if (automatic && loaded)")) throw new Error("failed CHANGELOG.txt fetch must not be marked seen");

console.log(JSON.stringify({ mobileForce60: true, changelog: "20260817-1", source: "CHANGELOG.txt", automaticShowsPerStoredProfile: 1, manualReopen: true }));
