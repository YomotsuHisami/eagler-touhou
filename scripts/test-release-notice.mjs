import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const html = read("index.html");
const styles = read("styles.css");
const app = read("app.js");
const changelog = read("CHANGELOG.txt");
const notice = read("NOTICE.txt");
const shells = [read("../th06-eagler/resources/shell.html"), read("../th07-eagler/resources/shell.html")];

const requireText = (source, needle, label) => {
  if (!source.includes(needle)) throw new Error(`missing ${label}: ${needle}`);
};

// Persistence reset contract: a profile written by the old host may contain
// limitPresentationTo60=true.  The renamed host-side key must start from
// false and the old key must have no route into restored state.
const defaultOptionsMatch = app.match(/const defaultOptions = Object\.freeze\((\{[\s\S]*?\})\);/);
if (!defaultOptionsMatch) throw new Error("defaultOptions object not found");
const parsedDefaults = Function(`"use strict"; return (${defaultOptionsMatch[1]});`)();
if (Object.hasOwn(parsedDefaults, "limitPresentationTo60")) {
  throw new Error("legacy limitPresentationTo60 key must not remain in host defaults");
}
if (parsedDefaults.frameLimit60Enabled !== false) {
  throw new Error("renamed frameLimit60Enabled must default to false");
}
const legacySavedOptions = { limitPresentationTo60: true };
const restoredFromLegacyTrue = { ...parsedDefaults };
for (const name of Object.keys(parsedDefaults)) {
  if (typeof legacySavedOptions[name] === typeof parsedDefaults[name]) restoredFromLegacyTrue[name] = legacySavedOptions[name];
}
if (restoredFromLegacyTrue.frameLimit60Enabled !== false) {
  throw new Error("legacy persisted true must restore as frameLimit60Enabled=false");
}

for (const [needle, label] of [
  ['id="frameLimitHint"', "frame-limit hint"],
  ['<title>EAGLER TOUHOU</title>', "short SEO title"],
  ['<meta name="description" content="东方红魔乡、妖妖梦网页版。">', "short SEO description"],
  ['rel="icon" href="assets/th06.ico" type="image/x-icon"', "TH06 favicon"],
  ['class="brand-title">EAGLER</span><span class="brand-separator"', "uppercase Touhou98 brand prefix"],
  ['class="brand-yinyang">☯</span></span>', "yin-yang brand emblem"],
  ['<span class="brand-title">TOUHOU</span>', "uppercase Touhou98 brand suffix"],
  ['href="assets/fonts/touhou98.woff2"', "Touhou98 font preload"],
  ['id="changelogOpen"', "manual changelog entry"],
  ['id="changelogDialog"', "changelog dialog"],
  ['id="changelogConfirm"', "changelog acknowledgement"],
  ['id="changelogText"', "structured changelog viewer"],
  ['<h1 id="changelogTitle">更新日志</h1>', "FAQ-like changelog title"],
]) requireText(html, needle, label);

for (const [needle, label] of [
  ['id="siteNotice" role="region" aria-label="网站公告" aria-live="polite" hidden', "floating site announcement"],
  ['class="site-notice-life" aria-hidden="true"', "site announcement lifetime bar"],
]) requireText(html, needle, label);

for (const [needle, label] of [
  ['const siteNoticeDurationMs = 12000;', "site announcement 12-second lifetime"],
  ['document.addEventListener("scroll", handleSiteNoticeScroll, { capture: true, passive: true });', "site announcement scroll-direction handling"],
  ['if (delta > 0 && current > 10) bar.classList.add("site-notice-scroll-hidden");', "site announcement hides on downward scroll"],
  ['else if (delta < 0) bar.classList.remove("site-notice-scroll-hidden");', "site announcement returns on upward scroll"],
  ['bar.classList.add("site-notice-closing");', "site announcement animates timed/manual close"],
  ['return "assets/notice-touhou-cloud.png";', "site announcement uses the provider-published Touhou Cloud icon"],
  ['return "assets/notice-bilibili.svg";', "site announcement uses the Mizuki/Font Awesome Bilibili icon"],
  ['link.className = "site-notice-brand";', "all announcement links use the same branded clickable element"],
  ['return "assets/th06.ico";', "FAQ announcement link uses the site favicon"],
  ['link.href = match[2];', "site announcement preserves relative site links without hardcoding an origin"],
]) requireText(app, needle, label);

for (const [needle, label] of [
  ['.site-notice{--site-notice-duration:12000ms;position:fixed;z-index:70;left:50%;bottom:', "bottom floating site announcement"],
  ['@keyframes site-notice-life{from{transform:scaleX(1)}to{transform:scaleX(0)}}', "site announcement lifetime indicator"],
  ['.site-notice-label{display:flex;align-items:center;gap:6px;width:max-content;margin:0 0 6px;color:#ff9aa3;font:700 9px/1', "announcement title has no extra left inset and uses tight optical line-height"],
  ['.site-notice-label:before{content:"";width:2px;height:8px', "announcement title uses a short vertical accent bar"],
  ['transform:translateY(.5px)', "announcement accent bar is optically centered with title text"],
  ['.site-notice-content{min-width:0;display:grid;gap:5px;color:rgba(255,255,255,.68)}', "announcement body has no title-axis indentation"],
  ['.site-notice.site-notice-closing{opacity:0;pointer-events:none;transform:translate(-50%,14px) scale(.985)}', "announcement close motion"],
  ['.site-notice-brand{display:inline-flex;align-items:center;gap:6px;min-height:25px', "announcement branded link pill"],
  ['.site-notice-brand-icon img{display:block;width:100%;height:100%;object-fit:contain}', "announcement local brand artwork sizing"],
]) requireText(styles, needle, label);

for (const [needle, label] of [
  ['[车万云](https://cloud.touhou.best/)', "Touhou Cloud named notice link"],
  ['[B站](https://www.bilibili.com/video/BV1yogK69EVy)', "Bilibili named notice link"],
  ['欢迎提出反馈，可前往 [B站](https://www.bilibili.com/video/BV1yogK69EVy) 视频留言。', "Bilibili feedback line"],
  ['反馈问题前，请先阅读 [常见问题](faq.html)。', "FAQ guidance line"],
]) requireText(notice, needle, label);
if (notice.includes("网页链接") || app.includes('link.textContent = "网页链接"')) {
  throw new Error("notice must keep named clickable brand links instead of generic webpage-link text");
}

if (/animation:site-notice-in[^}]*\bboth\b/.test(styles)) {
  throw new Error("site announcement enter animation must not retain transform/opacity after finishing");
}

for (const [needle, label] of [
  ['@font-face{font-family:"touhou98"', "Touhou98 font-face"],
  ['.brand-title,.brand-yinyang{position:relative;z-index:2;font-family:"touhou98",monospace', "Touhou98 brand foreground CSS"],
  ['.brand-separator{position:relative;display:inline-flex;justify-content:center;align-items:center;min-width:1.2em}', "yin-yang separator CSS"],
]) requireText(styles, needle, label);

for (const removedBrandFragment of ['brand-inline-mark']) {
  if (html.includes(removedBrandFragment) || styles.includes(removedBrandFragment)) {
    throw new Error(`removed brand icon fragment must stay absent: ${removedBrandFragment}`);
  }
}

const th06Icon = fs.readFileSync(path.join(root, "assets", "th06.ico"));
if (th06Icon.length !== 2238 || th06Icon.subarray(0, 6).toString("hex") !== "000001000100") {
  throw new Error("TH06 favicon must remain the reconstructed one-image Windows ICO");
}
const bilibiliNoticeIcon = read("assets/notice-bilibili.svg");
requireText(bilibiliNoticeIcon, 'viewBox="0 0 640 640"', "Font Awesome Bilibili icon viewBox");
requireText(bilibiliNoticeIcon, 'fill="#00aeec"', "Bilibili notice icon visible brand fill");
const touhouCloudNoticeIcon = fs.readFileSync(path.join(root, "assets", "notice-touhou-cloud.png"));
if (touhouCloudNoticeIcon.length !== 23262 || touhouCloudNoticeIcon.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
  throw new Error("Touhou Cloud notice icon must remain the provider-published PNG captured for this release");
}
const touhou98Font = fs.readFileSync(path.join(root, "assets", "fonts", "touhou98.woff2"));
if (touhou98Font.length !== 9416 || touhou98Font.subarray(0, 4).toString("ascii") !== "wOF2") {
  throw new Error("Touhou98 masthead font must remain the upstream 1.0.0 WOFF2 asset");
}

for (const [needle, label] of [
  ["修复了「松开第二根手指后仍持续低速，甚至无法移动」的问题", "touch release changelog item"],
  ["新增「锁定 60 帧」选项：电脑端可自行选择，移动端暂时强制启用", "mobile forced 60 changelog item"],
  ["此前版本没有维护正式的 CHANGELOG.txt", "historical changelog boundary"],
]) requireText(changelog, needle, label);

for (const [needle, label] of [
  ['const changelogVersion = "20260822-1";', "versioned changelog"],
  ['fetch(`CHANGELOG.txt?v=${encodeURIComponent(changelogVersion)}`, { cache: "no-store" })', "real versioned changelog text fetch"],
  ['frameLimit60Enabled: false,', "frame limit default off under new host persistence key"],
  ['frameLimitToggle.disabled = false;', "frame limit switch enabled on all devices"],
  ['frameLimitHint.textContent = "如果帧数在游玩时经常严重波动，那么必须启用该选项，否则会造成严重的输入延迟。";', "shared frame limit hint"],
  ['limitPresentationTo60: state.options.frameLimit60Enabled', "host-to-runtime frame-limit protocol mapping"],
  ['setOption("frameLimit60Enabled", !state.options.frameLimit60Enabled)', "new host-side frame-limit persistence key"],
  ['Object.prototype.hasOwnProperty.call(saved.options, "limitPresentationTo60")', "legacy frame-limit preference detection"],
  ['delete saved.options.limitPresentationTo60;', "legacy true frame-limit preference removal"],
  ['localStorage.setItem(preferenceKey(gameId), JSON.stringify(saved))', "legacy preference cleanup persistence"],
  ['localStorage.setItem(changelogSeenKey, "1")', "one-time seen marker"],
  ['localStorage.getItem(changelogSeenKey) === "1"', "one-time seen check"],
  ['if (!changelogSeen && !debugHarness && !touchPreview) void showChangelog(true);', "one-time auto show on normal user paths"],
  ['$("#changelogOpen").addEventListener("click", () => { void showChangelog(false); });', "manual reopen"],
]) requireText(app, needle, label);

if (app.includes('由于调度问题，移动端设备强制锁定 60 帧')) {
  throw new Error("mobile host must not retain the obsolete forced-60 notice");
}
if (app.includes('setOption("limitPresentationTo60"')) {
  throw new Error("old host-side limitPresentationTo60 persistence key must not be written anymore");
}

requireText(html, 'app.js?v=20260823-34', "host script cache key for current release");
requireText(html, 'styles.css?v=20260823-52', "host stylesheet cache key for current release");

for (const [needle, label] of [
  ["[2026-08-22] 手机性能、录像与交互更新", "2026-08-22 release section"],
  ["手机性能：重做 TH06 / TH07 Web 版的顶点流式提交方式", "mobile WebGL performance summary"],
  ["触摸录像：使用「触摸」「触摸（作弊，不限速）」或「轮盘（无方向限制）」时现在也可以保存录像", "touch replay summary"],
  ["触控灵敏度：直接触摸移动新增 50%～300% 连续灵敏度滑杆", "touch sensitivity summary"],
  ["手机端不再强制锁定 60 帧", "mobile frame-limit policy summary"],
  ["修复了 TH07 在部分旧版 Android WebView / Via 浏览器中可能持续音频卡顿甚至完全无声的问题", "TH07 mobile audio fix"],
  ["修复了手机触控下部分对话无法单击推进", "touch dialogue and stage-clear fix"],
]) requireText(changelog, needle, label);

if (changelog.includes("[2026-08-19]")) {
  throw new Error("2026-08-19 changes must remain merged into the unreleased 2026-08-18 release");
}

for (const [needle, label] of [
  ["[2026-08-18] HTTPS、触控与稳定性更新", "merged 2026-08-18 changelog section"],
  ["HTTPS 与数据迁移：推荐使用 https://touhou.vip/eagler-touhou/", "HTTPS and migration summary"],
  ["本地游戏数据：支持手动导入 TH06 / TH07 数据 ZIP", "local game-data import summary"],
  ["手机操控：新增「触摸」「触摸（作弊，不限速）」「轮盘」「轮盘（无方向限制）」四种移动方式", "mobile controls summary"],
  ["触控布局：新增可编辑的触控按键布局", "touch layout summary"],
  ["屏幕操作：新增实验性的放大镜与游戏内横/竖屏切换", "screen controls summary"],
  ["thprac：继续完善连续 Practice 的状态处理", "thprac adaptation summary"],
  ["修复了移动端在缩放、全屏、退出全屏或返回菜单后", "mobile gesture lifecycle changelog fix"],
  ["修正了锁定 60 帧时仍使用高刷新率残余插值的问题", "strict 60 interpolation changelog fix"],
  ["修复了 TH07 Music Room 中文说明", "TH07 Music Room changelog fix"],
  ["修复了 TH07 Demonstration 与 Ending 中额外的画面闪烁问题", "TH07 ending/demo changelog fix"],
  ["修复了普通窗口下游戏 4:3 画面可能按宽度放大后超出窗口下边缘的问题", "window canvas changelog fix"],
  ["修复了部分 Android 浏览器中蓝牙键盘方向键与 ESC 无法正常输入的问题", "Android keyboard changelog fix"],
]) requireText(changelog, needle, label);

for (const [needle, label] of [
  ["修复了「松开第二根手指后仍持续低速，甚至无法移动」的问题", "touch movement recovery changelog entry"],
  ["修复了「ESC 菜单双指操作后，后续点击和滑动全部失效」的问题", "pause menu gesture recovery changelog entry"],
  ["修复了「更新后浏览器可能混用新旧 Web 运行时文件」的问题", "runtime cache changelog entry"],
]) requireText(changelog, needle, label);

for (const [index, shell] of shells.entries()) {
  requireText(shell, "const mobileDevice = navigator.userAgentData?.mobile === true", `TH0${index + 6} shell mobile detection`);
  requireText(shell, "limitPresentationTo60: !!options.limitPresentationTo60", `TH0${index + 6} hosted optional frame limit`);
  requireText(shell, "limitPresentationTo60: false", `TH0${index + 6} standalone frame limit default off`);
}

const showStart = app.indexOf("async function showChangelog(automatic = false)");
const closeStart = app.indexOf("function closeChangelog()", showStart);
if (showStart < 0 || closeStart < 0) throw new Error("changelog function bounds missing");
const showBody = app.slice(showStart, closeStart);
if (showBody.indexOf("dialog.showModal();") > showBody.indexOf('localStorage.setItem(changelogSeenKey, "1")')) {
  throw new Error("automatic changelog must be marked seen immediately after successful showModal");
}
if (!showBody.includes("if (automatic && loaded)")) throw new Error("failed CHANGELOG.txt fetch must not be marked seen");

const aug18Start = changelog.indexOf("[2026-08-18]");
const aug17Start = changelog.indexOf("[2026-08-17]", aug18Start);
if (aug18Start < 0 || aug17Start < 0) throw new Error("2026-08-18 changelog bounds missing");
const aug18 = changelog.slice(aug18Start, aug17Start);
const aug18BugStart = aug18.indexOf("Bug 修复");
if (aug18BugStart < 0) throw new Error("2026-08-18 Bug 修复 heading missing");
if (!aug18.slice(0, aug18BugStart).includes("thprac：继续完善连续 Practice 的状态处理")) {
  throw new Error("thprac adaptation must remain in the 2026-08-18 功能更新 section");
}
if (aug18.slice(aug18BugStart).includes("thprac")) {
  throw new Error("thprac adaptation work must not be classified as a formal Bug 修复");
}

console.log(JSON.stringify({ mobileForce60: false, frameLimitDefault: false, changelog: "20260822-1", source: "CHANGELOG.txt", automaticShowsPerStoredProfile: 1, manualReopen: true }));
