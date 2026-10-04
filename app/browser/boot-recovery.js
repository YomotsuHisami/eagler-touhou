// ES5, inlined unchanged after the compatibility gate and before any modules.
// This small document owner is deliberately independent of Launcher services.
(function () {
  var gate = document.getElementById("browser-compatibility-gate");
  if (gate && gate.getAttribute("data-redirecting") === "true") return;
  if (window.__eaglerUiBoot) return;
  var script = document.getElementById("launcher-boot-watchdog");
  var messages = JSON.parse(script.getAttribute("data-messages"));
  var english = /(?:^|\/)en\.html$/.test(location.pathname);
  var localeQuery = /(?:\?|&)uiLocale=([^&]*)/.exec(location.search);
  // Match the Router's first-value semantics without requiring URLSearchParams.
  try {if (!english && localeQuery) english = decodeURIComponent(localeQuery[1].replace(/\+/g, " ")) === "en";} catch (_) {}
  var copy = messages[english ? "en" : "zh-CN"];
  var anchor = document.createElement("a");
  anchor.href = script.getAttribute("data-assets-url");
  var assets = anchor.href;
  var state = "pending", remaining = 12000, timer = null, timerStarted = 0;
  var active = true, diagnostic = "", diagnosis = "", cancelReload = null, reloadIssued = false;

  function stopTimer() {
    if (timer === null) return;
    clearTimeout(timer); timer = null;
    remaining = Math.max(0, remaining - Math.max(0, Date.now() - timerStarted));
  }
  function removePanel() {
    var panel = document.getElementById("launcher-boot-emergency");
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
  }
  function cleanup() {
    if (cancelReload) cancelReload();
    stopTimer();
    window.removeEventListener("error", onError, true);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("pagehide", onHide);
    window.removeEventListener("pageshow", onShow);
    document.removeEventListener("visibilitychange", schedule);
    document.removeEventListener("DOMContentLoaded", show);
  }
  function finish(next) {
    if (state === "ready" || state === "handled") return;
    state = next; cleanup(); removePanel();
  }
  function element(tag, text, style) {
    var node = document.createElement(tag);
    if (text) node.textContent = text;
    if (style) node.style.cssText = style;
    return node;
  }
  function reloadRecovery(panel) {
    function current() {return state === "failed" && !reloadIssued && window.__eaglerUiBoot === owner && document.getElementById("launcher-boot-emergency") === panel;}
    if (!current() || cancelReload) return;
    var urls = [], links = document.getElementsByTagName("link"), i, url;
    // WebKit bug 270357 can retain a failed modulepreload across normal Reload.
    // A raw cache-reload request invalidates the failed script resource first.
    // Only this explicit action does I/O; never forward queries or credentials.
    if (typeof window.fetch === "function" && assets.indexOf(location.protocol + "//" + location.host + "/") === 0) {
      for (i = 0; i < links.length && urls.length < 64; i++) {
        url = links[i].href;
        if (links[i].rel === "modulepreload" && typeof url === "string" && url.indexOf(assets) === 0 &&
            /^[A-Za-z0-9_.-]+\.m?js$/.test(url.slice(assets.length)) && urls.indexOf(url) === -1) urls.push(url);
      }
    }
    if (!urls.length) {reloadIssued = true; location.reload(); return;}
    var left = urls.length, ended = false, timeout = null;
    var controller = typeof window.AbortController === "function" ? new window.AbortController() : null;
    function cancel() {
      if (ended) return;
      ended = true;
      if (timeout !== null) clearTimeout(timeout);
      window.removeEventListener("pagehide", cancel);
      if (controller) controller.abort();
      cancelReload = null;
    }
    function finish() {
      if (ended) return;
      var reload = current(); cancel(); if (reload) {reloadIssued = true; location.reload();}
    }
    function settled() {left--; if (!left) finish();}
    cancelReload = cancel;
    window.addEventListener("pagehide", cancel);
    timeout = setTimeout(finish, 2000);
    for (i = 0; i < urls.length; i++) {
      try {
        window.fetch(urls[i], {cache:"reload", mode:"same-origin", credentials:"omit", redirect:"error", referrerPolicy:"no-referrer",
          signal:controller ? controller.signal : undefined}).then(function (response) {return response.arrayBuffer();}).then(settled, settled);
      } catch (_) {settled();}
    }
  }
  function show() {
    if (state !== "failed" || document.getElementById("launcher-boot-emergency")) return;
    var mount = document.getElementById("launcher-boot-recovery");
    if (!mount) {document.addEventListener("DOMContentLoaded", show); return;}
    document.removeEventListener("DOMContentLoaded", show);
    var panel = element("section", "", "position:fixed;z-index:2147483647;top:0;right:0;bottom:0;left:0;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;background:#0d0d0ce6;font:14px/1.6 system-ui,-apple-system,sans-serif;text-align:left;white-space:normal");
    panel.id = "launcher-boot-emergency";
    panel.lang = english ? "en" : "zh-CN";
    panel.setAttribute("role", "alert");
    panel.setAttribute("aria-labelledby", "launcher-boot-title");
    var card = element("div", "", "box-sizing:border-box;width:460px;max-width:100%;max-height:82vh;overflow:auto;padding:24px;border:1px solid #ebe7df33;border-radius:22px;background:#191a17;color:#ebe7df;box-shadow:0 24px 70px #0009");
    var title = element("h1", copy["boot.title"], "margin:0 0 10px;color:#ef6a58;font-size:20px;line-height:1.3");
    title.id = "launcher-boot-title";
    card.appendChild(title);
    card.appendChild(element("p", diagnosis, "margin:0 0 8px"));
    card.appendChild(element("p", copy["boot.hint"], "margin:0;color:#bdb8b0;font-size:12px"));
    var details = element("details", "", "margin-top:16px");
    details.appendChild(element("summary", copy["boot.details"], "cursor:pointer"));
    var code = element("pre", diagnostic, "padding:12px;border-radius:10px;background:#10110f;color:#bdb8b0;font:12px/1.5 monospace;white-space:pre-wrap;word-break:break-word;user-select:text");
    code.id = "launcher-boot-diagnostics";
    details.appendChild(code); card.appendChild(details);
    var actions = element("div", "", "display:flex;gap:10px;flex-wrap:wrap;margin-top:18px");
    function button(label, action, primary) {
      var node = element("button", label, "min-height:44px;padding:10px 16px;border:1px solid #ebe7df33;border-radius:11px;background:" + (primary ? "#ef6a58;color:#141413" : "#292b27;color:#ebe7df") + ";font:700 14px/1.3 system-ui;cursor:pointer");
      node.type = "button"; node.addEventListener("click", action); actions.appendChild(node); return node;
    }
    var reload = button(copy["boot.reload"], function () {reloadRecovery(panel);}, true);
    var status = element("p", "", "margin:10px 0 0;color:#bdb8b0;font-size:12px");
    status.setAttribute("role", "status");
    button(copy["boot.copy"], function () {
      function result(ok) {status.textContent = copy[ok ? "boot.copied" : "boot.copyFailed"]; if (!ok) details.open = true;}
      function fallback() {
        var focused = document.activeElement;
        var area = element("textarea", "", "position:fixed;width:1px;height:1px;opacity:0");
        area.value = diagnostic; area.readOnly = true; card.appendChild(area);
        var ok = false;
        try {area.select(); ok = document.execCommand("copy");} catch (_) {}
        card.removeChild(area);
        if (focused && focused.focus) focused.focus();
        result(ok);
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(diagnostic).then(function () {result(true);}, fallback); return;
        }
      } catch (_) {}
      fallback();
    }, false);
    card.appendChild(actions); card.appendChild(status); panel.appendChild(card); mount.appendChild(panel);
    reload.focus();
  }
  function fail(kind) {
    if (state !== "pending" || !active) return;
    state = "failed"; cleanup();
    // Only bounded, non-identifying facts. Never include URLs, query/room codes,
    // exception messages/stacks, UA, storage contents, or automatic telemetry.
    diagnostic = ["EAGLER-BOOT/2", "scope=initial-hydration", "kind=" + kind,
      "elapsed_active_ms=" + (12000 - remaining),
      "online=" + (typeof navigator.onLine === "boolean" ? String(navigator.onLine) : "unknown")].join("\n");
    diagnosis = copy[kind === "watchdog" ? "boot.timeout" : kind === "javascript" ? "boot.javascript" : "boot.script"];
    show();
  }
  function ownedModule(value) {
    // No URL is retained or displayed. Initial Framework assets are scoped to
    // the build mount; images, game frames, external scripts and requests aren't.
    return typeof value === "string" && value.indexOf(assets) === 0 && /\.m?js(?:[?#]|$)/.test(value.slice(assets.length));
  }
  function onError(event) {
    var target = event.target;
    if (target && target !== window) {
      if (target.tagName === "SCRIPT" && target.type === "module" &&
          (ownedModule(target.src) || target.getAttribute && target.getAttribute("data-launcher-boot-module") !== null)) fail("script-load");
      return;
    }
    if (ownedModule(event.filename)) fail("javascript");
  }
  function onRejection(event) {
    // Do not call ordinary application/network rejections a failed boot.
    // Opaque import errors still have the bounded watchdog as their fallback.
    var message = event.reason && event.reason.message;
    if (typeof message === "string" && /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(message) && message.indexOf(assets) !== -1) fail("module-load");
  }
  function schedule() {
    stopTimer();
    if (state !== "pending" || !active || document.visibilityState === "hidden") return;
    timerStarted = Date.now();
    timer = setTimeout(function () {fail("watchdog");}, remaining);
  }
  function onHide() {active = false; stopTimer();}
  function onShow() {active = true; schedule();}
  var owner = {ready: function () {finish("ready");}, handled: function () {finish("handled");}};
  window.__eaglerUiBoot = owner;
  window.addEventListener("error", onError, true);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("pagehide", onHide);
  window.addEventListener("pageshow", onShow);
  document.addEventListener("visibilitychange", schedule);
  schedule();
}());
