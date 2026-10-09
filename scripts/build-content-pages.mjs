#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marked, Renderer } from "marked";
import { writeFileAtomic } from "../lib/atomic-file.mjs";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const faqSourcePath = resolve(project, "docs", "FAQ.md");
const faqOutputPath = resolve(project, "public", "faq.html");
const firstUseNoticeSourcePath = resolve(project, "content", "FIRST_USE_NOTICE.md");
const firstUseNoticeOutputPath = resolve(project, "public", "content", "FIRST_USE_NOTICE.html");
const multiplayerSourcePath = resolve(project, "content", "MULTIPLAYER.md");
const multiplayerOutputPath = resolve(project, "public", "content", "MULTIPLAYER.html");
const check = process.argv.includes("--check");
const quiet = process.argv.includes("--quiet");
if (process.argv.slice(2).some(value => value !== "--check" && value !== "--quiet")) {
  throw new Error("usage: node scripts/build-content-pages.mjs [--check] [--quiet]");
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function safeContentHref(value) {
  const href = String(value || "").trim();
  if (!href) return "";
  try {
    const resolved = new URL(href, "https://eagler.invalid/");
    return resolved.protocol === "http:" || resolved.protocol === "https:" ? href : "";
  } catch {
    return "";
  }
}

const renderer = new Renderer();
renderer.link = function link(token) {
  const href = safeContentHref(token.href);
  if (!href) return this.parser.parseInline(token.tokens);
  const title = token.title ? ` title="${escapeAttribute(token.title)}"` : "";
  const external = /^https?:\/\//i.test(href) ? ' target="_blank" rel="noopener"' : "";
  return `<a href="${escapeAttribute(href)}"${title}${external}>${this.parser.parseInline(token.tokens)}</a>`;
};
renderer.image = function image(token) {
  const href = safeContentHref(token.href);
  if (!href) return escapeHtml(token.text || "");
  const title = token.title ? ` title="${escapeAttribute(token.title)}"` : "";
  return `<img src="${escapeAttribute(href)}" alt="${escapeAttribute(token.text || "")}"${title} loading="lazy">`;
};
renderer.blockquote = function blockquote(token) {
  return `<blockquote class="markdown-blockquote">\n${this.parser.parse(token.tokens)}</blockquote>\n`;
};
// Browser-facing Markdown is compiled into trusted static HTML. Raw authored
// HTML remains text rather than becoming a second, unsanitized markup channel.
renderer.html = token => escapeHtml(token.text || "");

function normalizeMarkdown(source) {
  return String(source).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
}

function lexMarkdown(source) {
  return marked.lexer(normalizeMarkdown(source), { gfm: true });
}

function withoutLeadingTitle(tokens) {
  const result = [...tokens];
  if (result[0]?.type === "heading" && result[0].depth === 1) result.shift();
  while (result[0]?.type === "space") result.shift();
  return result;
}

function renderTokens(tokens) {
  return marked.parser(tokens, { renderer }).trim();
}

function renderFirstUseNoticeFragment(source) {
  if (!normalizeMarkdown(source)) return "";
  const tokens = withoutLeadingTitle(lexMarkdown(source));
  const groups = [];
  let current = [];
  for (const token of tokens) {
    if (token.type === "heading" && token.depth === 2 && current.length) {
      groups.push(current);
      current = [];
    }
    current.push(token);
  }
  if (current.length) groups.push(current);
  const sections = groups
    .map(group => `<section class="first-use-notice-item">\n${renderTokens(group)}\n</section>`)
    .join("\n");
  return `<div class="first-use-notice-list">\n${sections}\n</div>\n`;
}

function renderMultiplayerFragment(source) {
  if (!normalizeMarkdown(source)) return "";
  const content = renderTokens(withoutLeadingTitle(lexMarkdown(source)));
  return content ? `${content}\n` : "";
}

const faqMarkdown = normalizeMarkdown(await readFile(faqSourcePath, "utf8"));
const content = marked.parse(faqMarkdown, { async: false, gfm: true, renderer });
if (typeof content !== "string" || !content.includes("<h1>常见问题</h1>")) {
  throw new Error("docs/FAQ.md must contain the level-one heading '常见问题'");
}
const emphasisStack = [];
for (const match of content.matchAll(/<(\/)?(strong|em)>/gi)) {
  const tag = match[2].toLowerCase();
  if (!match[1]) {
    if (emphasisStack.includes(tag)) {
      throw new Error(`docs/FAQ.md produced nested <${tag}> markup; add spacing around adjacent emphasis`);
    }
    emphasisStack.push(tag);
  } else if (emphasisStack.pop() !== tag) {
    throw new Error("docs/FAQ.md produced mismatched emphasis markup");
  }
}

const faqHtml = `<!doctype html>
<!-- Generated from docs/FAQ.md by the content-page build. Do not edit this file directly. -->
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#0d0d0c" id="themeColorMeta">
  <script>
  (function () {
    try {
      if (localStorage.getItem("eagler-theme") === "light") {
        document.documentElement.setAttribute("data-theme", "light");
      }
    } catch (e) {}
  }());
  </script>
  <title>常见问题 ~ EAGLER TOUHOU</title>
  <meta name="description" content="EAGLER TOUHOU 的浏览器兼容、操作说明、存档、作品支持和常见故障解答。">
  <link rel="icon" href="assets/th06.ico" type="image/x-icon">
  <link rel="preload" href="assets/fonts/chill-round-gothic-site-medium.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="assets/fonts/yatra-one-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="styles.css">
  <link rel="stylesheet" href="about.css">
</head>
<body class="about-body">
  <button class="theme-toggle-fab" id="themeToggle" type="button" aria-pressed="false" aria-label="切换到白天模式" title="白天 / 夜间">
    <svg class="theme-icon theme-icon-sun" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM11 2h2v3h-2V2zm0 17h2v3h-2v-3zM2 11h3v2H2v-2zm17 0h3v2h-3v-2zM4.2 4.2l2.1 2.1-1.4 1.4-2.1-2.1 1.4-1.4zm14.9 14.9 2.1 2.1-1.4 1.4-2.1-2.1 1.4-1.4zM4.2 19.8l2.1-2.1 1.4 1.4-2.1 2.1-1.4-1.4zm14.9-14.9 2.1-2.1 1.4 1.4-2.1 2.1-1.4-1.4z"/></svg>
    <svg class="theme-icon theme-icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>
  </button>
  <main class="about-page">
    <p class="about-back"><a href="./">← 返回 EAGLER TOUHOU</a></p>
    <article class="faq-content" aria-label="常见问题列表">
${content.trimEnd().split("\n").map(line => `      ${line}`).join("\n")}
    </article>
  </main>
  <script>
    (function () {
      var root = document.documentElement;
      var meta = document.getElementById("themeColorMeta");
      var btn = document.getElementById("themeToggle");
      if (!btn) return;
      function isLight() { return root.getAttribute("data-theme") === "light"; }
      function apply(light) {
        if (light) {
          root.setAttribute("data-theme", "light");
          if (meta) meta.setAttribute("content", "#e9e4db");
          btn.setAttribute("aria-pressed", "true");
          btn.setAttribute("aria-label", "切换到夜间模式");
        } else {
          root.removeAttribute("data-theme");
          if (meta) meta.setAttribute("content", "#0d0d0c");
          btn.setAttribute("aria-pressed", "false");
          btn.setAttribute("aria-label", "切换到白天模式");
        }
      }
      apply(isLight());
      btn.addEventListener("click", function () {
        var next = !isLight();
        try { localStorage.setItem("eagler-theme", next ? "light" : "dark"); } catch (e) {}
        apply(next);
      });
    }());
  </script>
</body>
</html>
`;

const firstUseNoticeHtml = renderFirstUseNoticeFragment(await readFile(firstUseNoticeSourcePath, "utf8"));
const multiplayerHtml = renderMultiplayerFragment(await readFile(multiplayerSourcePath, "utf8"));

async function emit(path, body, staleMessage) {
  if (check) {
    let current = "";
    try { current = await readFile(path, "utf8"); } catch {}
    if (current !== body) throw new Error(staleMessage);
    return;
  }
  await writeFileAtomic(path, body, "utf8");
}

await emit(faqOutputPath, faqHtml, "public/faq.html is stale; run npm run build:content");
await emit(firstUseNoticeOutputPath, firstUseNoticeHtml, "public/content/FIRST_USE_NOTICE.html is stale; run npm run build:content");
await emit(multiplayerOutputPath, multiplayerHtml, "public/content/MULTIPLAYER.html is stale; run npm run build:content");
if (!quiet) console.log(`Content pages: ${check ? "PASS" : "built"} (FAQ + First-use Notice + Multiplayer Guide)`);
