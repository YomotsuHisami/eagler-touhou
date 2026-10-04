"use strict";

// App-owned shell and Runtime only; never intercept or delete Package Store data.
const CACHE_PREFIX = "eagler-touhou-app-shell-";
const scopeUrl = new URL(self.registration.scope);
const CACHE_NAME = `${CACHE_PREFIX}${encodeURIComponent(scopeUrl.pathname)}-__APP_SHELL_BUILD_ID__`;
const CACHE_RETENTION = 2;
const PRECACHE_CONCURRENCY = 3;
const FETCH_TIMEOUT_MS = 30000;
const PRECACHE_MANIFEST = self.__WB_MANIFEST;
const DEFERRED_PATHS = new Set(__APP_SHELL_DEFERRED_PATHS__.map(path => new URL(path, scopeUrl).href));
const metaPrefix = new URL("./__app-shell-meta__/", scopeUrl).href;
const cacheMetaUrl = `${metaPrefix}__APP_SHELL_BUILD_ID__`;
const updateStatusUrl = new URL("./__app-shell-update-status__", scopeUrl).href;
// Kept in this worker, not a second independently updating Service Worker.
const runtimeCache = typeof createRuntimeCache === "function" && self.__EAGLER_RUNTIME_MANIFEST
  ? createRuntimeCache({ scopeUrl, catalog: self.__EAGLER_RUNTIME_MANIFEST }) : null;
let currentMetadataUpdate = Promise.resolve();
const manifestByPathname = new Map(PRECACHE_MANIFEST.map(entry => {
  const url = new URL(entry.url, scopeUrl);
  return [url.pathname, { ...entry, cacheUrl: url.href }];
}));

async function cacheMetadata(name) {
  try {
    const cache = await caches.open(name);
    const key = (await cache.keys()).find(request => request.url.startsWith(metaPrefix));
    return key ? await (await cache.match(key)).json() : null;
  } catch { return null; }
}

async function previousCaches() {
  const names = (await caches.keys()).filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME);
  const entries = await Promise.all(names.map(async name => ({ name, metadata: await cacheMetadata(name) })));
  // CacheStorage is origin-wide. The metadata URL, not just the name prefix,
  // proves ownership, including caches written by the pre-scoped worker.
  return entries.filter(entry => entry.metadata?.entries)
    .sort((a, b) => (Number(b.metadata.createdAt) || 0) - (Number(a.metadata.createdAt) || 0));
}

function runtimeGroup(url) {
  const path = new URL(url).pathname.slice(scopeUrl.pathname.length);
  const parts = path.split("/");
  return parts[0] === "runtime" && parts.length > 2
    ? `${parts[0]}/${parts[1]}/`
    : path.slice(0, path.lastIndexOf("/") + 1);
}

async function fetchVerified(entry) {
  if (!/^[a-f0-9]{64}$/i.test(entry.revision || "")) {
    throw new Error(`App Shell revision is not SHA-256: ${entry.cacheUrl}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(new Request(entry.cacheUrl, { cache: "reload", signal: controller.signal }));
    if (!response.ok) throw new Error(`App Shell cache failed: ${entry.cacheUrl} HTTP ${response.status}`);
    const bytes = await response.clone().arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    if (actual !== entry.revision.toLowerCase()) throw new Error(`App Shell integrity mismatch: ${entry.cacheUrl}`);
    return response;
  } finally { clearTimeout(timer); }
}

async function reusableResponse(entry, previous) {
  for (const { name, metadata } of previous) {
    if (metadata.integrity !== "sha256-v1" || !entry.revision || metadata.entries[entry.cacheUrl] !== entry.revision) continue;
    if (DEFERRED_PATHS.has(entry.cacheUrl) && metadata.runtimeTrusted?.[entry.cacheUrl] !== entry.revision) continue;
    const response = await (await caches.open(name)).match(entry.cacheUrl);
    if (response) return response;
  }
  return null;
}

async function runPool(entries, action) {
  let cursor = 0;
  // Drain every writer before callers clean up a failed candidate. Promise.all
  // alone can reject while another writer is still creating cache entries.
  const results = await Promise.allSettled(Array.from({ length: Math.min(PRECACHE_CONCURRENCY, entries.length) }, async () => {
    while (cursor < entries.length) await action(entries[cursor++]);
  }));
  const failure = results.find(result => result.status === "rejected");
  if (failure) throw failure.reason;
}

async function precacheShell() {
  const previous = await previousCaches();
  const entries = [...manifestByPathname.values()];
  // First installs and replacements both cache only the Launcher shell.
  // Runtime preparation belongs to the selected game's on-demand transaction;
  // an unrelated Runtime must not delay or fail a Launcher update.
  const required = entries.filter(entry => !DEFERRED_PATHS.has(entry.cacheUrl));
  const cache = await caches.open(CACHE_NAME);
  const metadata = {
    build: "__APP_SHELL_BUILD_ID__", createdAt: Date.now(), appliedAt: null,
    updated: previous.length > 0, integrity: "sha256-v1",
    entries: Object.fromEntries(entries.map(entry => [entry.cacheUrl, entry.revision || null])),
    runtimeTrusted: {},
    install: { reused: 0, fetched: 0, deferred: entries.length - required.length },
  };
  try {
    await runPool(required, async entry => {
      const reused = await reusableResponse(entry, previous);
      const response = reused || await fetchVerified(entry);
      await cache.put(entry.cacheUrl, response);
      metadata.install[reused ? "reused" : "fetched"]++;
      if (DEFERRED_PATHS.has(entry.cacheUrl)) metadata.runtimeTrusted[entry.cacheUrl] = entry.revision;
    });
    await writeCurrentCacheMetadata(metadata);
  } catch (error) {
    await caches.delete(CACHE_NAME);
    throw error;
  }
}

async function writeCurrentCacheMetadata(metadata) {
  const cache = await caches.open(CACHE_NAME);
  await cache.put(cacheMetaUrl, new Response(JSON.stringify(metadata), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  }));
}

async function updateCurrentCacheMetadata(update) {
  const task = currentMetadataUpdate.then(async () => {
    const metadata = await cacheMetadata(CACHE_NAME) || {};
    update(metadata);
    await writeCurrentCacheMetadata(metadata);
    return metadata;
  });
  currentMetadataUpdate = task.catch(() => {});
  return task;
}

async function collectAfterShellUse(metadata) {
  // Never prune during activation: activation can run while the browser is
  // shutting down, before its replacement registration has been persisted.
  // Only a live client using this worker can acknowledge a successful handoff.
  const previous = await previousCaches();
  const older = previous.filter(entry => Number(entry.metadata.createdAt) < Number(metadata.createdAt));
  older.sort((a, b) => (Number(b.metadata.lastUsedAt) || 0) - (Number(a.metadata.lastUsedAt) || 0)
    || Number(b.metadata.createdAt) - Number(a.metadata.createdAt));
  // Keep the last actually used version, not a more recently installed but
  // never activated candidate. Newer/waiting candidates are never collected.
  for (const entry of older.slice(CACHE_RETENTION - 1)) await caches.delete(entry.name);
}

async function appShellUpdateStatus() {
  if (!await cacheMetadata(CACHE_NAME)) return new Response(null, { status: 503 });
  const metadata = await updateCurrentCacheMetadata(status => {
    if (status.updated === true && !(Number(status.appliedAt) > 0)) status.appliedAt = Date.now();
    status.lastUsedAt = Date.now();
  });
  try { await collectAfterShellUse(metadata); }
  catch { /* Cache cleanup is optional, never a Launcher boot dependency. */ }
  return new Response(JSON.stringify(metadata), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

self.addEventListener("install", event => {
  // Publish only after the complete required shell passes integrity checks.
  // The current Launcher requests activation when its own session is idle.
  event.waitUntil(precacheShell());
});
self.addEventListener("activate", event => {
  // No destructive work on shutdown-triggered activation. Keep the former
  // active worker's cache until a new live client acknowledges this version.
  // Do not claim a network-loaded document half way through its module graph.
  event.waitUntil(Promise.resolve());
});

async function shellCacheFirst(entry) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(entry.cacheUrl);
  if (cached) return cached;
  const response = await reusableResponse(entry, await previousCaches()) || await fetchVerified(entry);
  await cache.put(entry.cacheUrl, response.clone());
  if (DEFERRED_PATHS.has(entry.cacheUrl)) {
    await updateCurrentCacheMetadata(metadata => {
      metadata.runtimeTrusted ||= {};
      metadata.runtimeTrusted[entry.cacheUrl] = entry.revision;
    });
  }
  return response;
}

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  if (event.request.url === updateStatusUrl) {
    event.respondWith(appShellUpdateStatus());
    return;
  }
  // Runtime navigation performs latest-first transaction selection before any
  // HTML/JS executes. Subresources stay pinned to that document's snapshot.
  const runtimeResponse = runtimeCache?.handle(event);
  if (runtimeResponse) {
    event.respondWith(runtimeResponse);
    return;
  }
  const url = new URL(event.request.url);
  if (url.origin !== scopeUrl.origin) return;
  const entry = manifestByPathname.get(url.pathname);
  if (entry) {
    event.respondWith(shellCacheFirst(entry));
    return;
  }
  // Opt-in Framework navigation comes after Runtime ownership and exact files.
  // Legacy builds have no resolver; resource/unknown URLs never become HTML.
  const fallback = self.__EAGLER_UI_NAVIGATION_FALLBACK?.(event.request, scopeUrl.href);
  const shell = fallback && manifestByPathname.get(new URL(fallback).pathname);
  if (shell) event.respondWith(shellCacheFirst(shell));
});

async function offlineStatus() {
  const metadata = await cacheMetadata(CACHE_NAME);
  const cache = await caches.open(CACHE_NAME);
  const groups = new Map();
  for (const entry of manifestByPathname.values()) {
    if (!DEFERRED_PATHS.has(entry.cacheUrl)) continue;
    const group = runtimeGroup(entry.cacheUrl);
    const ready = metadata?.runtimeTrusted?.[entry.cacheUrl] === entry.revision && !!await cache.match(entry.cacheUrl);
    groups.set(group, (groups.get(group) ?? true) && ready);
  }
  return { ok: true, build: metadata?.build || null, shellReady: !!metadata,
    runtimeGroups: runtimeCache ? await runtimeCache.readyGroups()
      : [...groups].filter(([, ready]) => ready).map(([group]) => group) };
}

self.addEventListener("message", event => {
  const type = event.data?.type;
  const protocol = typeof EaglerRuntimeGenerations !== "undefined" ? EaglerRuntimeGenerations : null;
  if (!["CACHE_APP_SHELL_PATHS", "GET_APP_SHELL_STATUS", "CHECK_APP_SHELL_ACTIVATION", "ACTIVATE_APP_SHELL",
    protocol?.RUNTIME_CAPABILITIES, protocol?.RUNTIME_PREPARE].includes(type)) return;
  const port = event.ports?.[0];
  event.waitUntil((async () => {
    try {
      if (type === "CHECK_APP_SHELL_ACTIVATION" || type === "ACTIVATE_APP_SHELL") {
        if (type === "CHECK_APP_SHELL_ACTIVATION") {
          // Older launchers may still ask before sending ACTIVATE.
          port?.postMessage({ ok: true, soleClient: true });
          return;
        }
        await self.skipWaiting();
        port?.postMessage({ ok: true, activating: true });
        return;
      }
      if (protocol && type === protocol.RUNTIME_CAPABILITIES) {
        port?.postMessage({ ok: !!runtimeCache, protocol: protocol.RUNTIME_CACHE_PROTOCOL });
        return;
      }
      if (protocol && type === protocol.RUNTIME_PREPARE) {
        if (!runtimeCache) throw new Error("Immutable Runtime cache unavailable");
        const request = protocol.validateRuntimePrepareRequest(event.data);
        port?.postMessage(await runtimeCache.prepareLaunch(request.entry, {
          exclude: request.exclude, ...(request.catalog ? { catalog: request.catalog } : {}),
        }));
        return;
      }
      if (type === "GET_APP_SHELL_STATUS") {
        port?.postMessage(await offlineStatus());
        return;
      }
      if (!Array.isArray(event.data.paths)) throw new Error("Runtime cache paths must be an array");
      const entries = event.data.paths.map(path => {
        const url = new URL(String(path), scopeUrl);
        if (url.origin !== scopeUrl.origin) throw new Error(`Runtime cache path is cross-origin: ${url.href}`);
        if (runtimeCache && url.pathname.startsWith(scopeUrl.pathname + "runtime/")) return { cacheUrl: url.href };
        const entry = manifestByPathname.get(url.pathname);
        if (!entry) throw new Error(`Runtime cache path is not published: ${url.pathname}`);
        return entry;
      });
      if (runtimeCache) await runtimeCache.preparePaths(entries.map(entry => new URL(entry.cacheUrl).pathname.slice(scopeUrl.pathname.length)).filter(path => path.startsWith("runtime/")));
      await runPool(entries.filter(entry => !runtimeCache || !new URL(entry.cacheUrl).pathname.startsWith(scopeUrl.pathname + "runtime/")), shellCacheFirst);
      port?.postMessage({ ok: true, cached: entries.length });
    } catch (error) {
      port?.postMessage({ ok: false, code: error?.name || "Error", error: error instanceof Error ? error.message : String(error) });
    }
  })());
});
