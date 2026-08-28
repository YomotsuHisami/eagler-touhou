"use strict";

// App Shell only. Game content and Runtime preparation are intentionally not
// routed through this worker.
const CACHE_PREFIX = "eagler-touhou-app-shell-";
const CACHE_NAME = `${CACHE_PREFIX}__APP_SHELL_BUILD_ID__`;
const CACHE_RETENTION = 2;
const PRECACHE_CONCURRENCY = 3;
const scopeUrl = new URL(self.registration.scope);
const PRECACHE_MANIFEST = self.__WB_MANIFEST;
const cacheMetaUrl = new URL(`./__app-shell-meta__/__APP_SHELL_BUILD_ID__`, scopeUrl).href;

const manifestByPathname = new Map(PRECACHE_MANIFEST.map(entry => {
  const url = new URL(entry.url, scopeUrl);
  return [url.pathname, { ...entry, cacheUrl: url.href }];
}));

async function precacheShell() {
  const cache = await caches.open(CACHE_NAME);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(PRECACHE_CONCURRENCY, PRECACHE_MANIFEST.length) }, async () => {
    while (cursor < PRECACHE_MANIFEST.length) {
      const entry = PRECACHE_MANIFEST[cursor++];
      const cacheUrl = new URL(entry.url, scopeUrl).href;
      const request = new Request(cacheUrl, { cache: "reload" });
      const response = await fetch(request);
      if (!response.ok) throw new Error(`App Shell precache failed: ${request.url} HTTP ${response.status}`);
      await cache.put(cacheUrl, response);
    }
  }));
  await cache.put(cacheMetaUrl, new Response(JSON.stringify({
    build: "__APP_SHELL_BUILD_ID__",
    createdAt: Date.now(),
  }), { headers: { "Content-Type": "application/json" } }));
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    await precacheShell();
    await self.skipWaiting();
  })());
});

async function cacheCreatedAt(name) {
  try {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    const metaKey = keys.find(request => new URL(request.url).pathname.includes("/__app-shell-meta__/"));
    if (!metaKey) return 0;
    const response = await cache.match(metaKey);
    const parsed = await response?.json();
    return Number(parsed?.createdAt) || 0;
  } catch {
    return 0;
  }
}

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const shellCaches = (await caches.keys()).filter(name => name.startsWith(CACHE_PREFIX));
    const ranked = await Promise.all(shellCaches.map(async name => ({ name, createdAt: await cacheCreatedAt(name) })));
    ranked.sort((a, b) => b.createdAt - a.createdAt);
    for (const entry of ranked.slice(CACHE_RETENTION)) await caches.delete(entry.name);
    await self.clients.claim();
  })());
});

function manifestEntryForRequest(request) {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (url.origin !== scopeUrl.origin) return null;
  return manifestByPathname.get(url.pathname) || null;
}

async function shellCacheFirst(request, entry) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(entry.cacheUrl);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(entry.cacheUrl, response.clone());
  return response;
}

self.addEventListener("fetch", event => {
  const entry = manifestEntryForRequest(event.request);
  if (!entry) return;
  event.respondWith(shellCacheFirst(event.request, entry));
});
