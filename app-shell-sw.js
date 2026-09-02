"use strict";

// App Shell only. Game content and Runtime preparation are intentionally not
// routed through this worker.
const CACHE_PREFIX = "eagler-touhou-app-shell-";
const CACHE_NAME = `${CACHE_PREFIX}ae9793261f7ea4ecfda7`;
const CACHE_RETENTION = 2;
const PRECACHE_CONCURRENCY = 3;
const scopeUrl = new URL(self.registration.scope);
const PRECACHE_MANIFEST = [{"revision":"2017cbd70ba7674db9456c418d307f89","url":"index.html"},{"revision":"bcf7f00a8cfa414eb31252f49c7cfd97","url":"site.webmanifest"},{"revision":"7665c9549e9531cc0906ddeef60b163a","url":"styles.css"},{"revision":"4d2b8c794ca1f9b0d6c099d14e4b3949","url":"touch-guide.css"},{"revision":"c79edb71c46587ad8cba92e831089246","url":"about.css"},{"revision":"e82d0299cae16b3a6fc33c67e0cf105d","url":"app.js"},{"revision":"d3ee375da9be34c909607d4a17c79530","url":"migrate.html"},{"revision":"a1ca46817d8c44117e6838eb73b4a605","url":"about.html"},{"revision":"bf0d7ac597ccbb5c40514d601c87661d","url":"faq.html"},{"revision":"070e745b428ce63d1c05684ba0c0a547","url":"game-data-import.js"},{"revision":"f56191b08d9c7faa19b6a4e872f61272","url":"game-data-import.mjs"},{"revision":"ed96f8ee0988e64eeaafaffd9d7c319c","url":"network-activity.mjs"},{"revision":"feaa848e4a2b73da9530d3a6586aa187","url":"package-descriptor.mjs"},{"revision":"e18b70f214970f0f45b13d84443c301a","url":"package-generation.mjs"},{"revision":"b25d116d782b0c9d098b2fa137ce6184","url":"package-store.mjs"},{"revision":"c93a67e571d1210c7d06281b33425a7f","url":"runtime-preparation.mjs"},{"revision":"6bb26f38929e036628aceb1dce07f25a","url":"package-zip.mjs"},{"revision":"d46298daed4d50a9d99679fdbb50f1e4","url":"package-installer.mjs"},{"revision":"93e25d2f4d5b5ae65844c8110abcb634","url":"package-launcher.mjs"},{"revision":"9874b472645c03c96b6546ccc20d8310","url":"product-catalog.mjs"},{"revision":"8cb5b0f2a2ac44f5da84f390bd5a0065","url":"release-catalog.mjs"},{"revision":"aaea4e81b1ac4fd40187192d38bc66da","url":"vendor/fflate.min.js"},{"revision":"2076842e3a51655a2d8d56f78c4c1360","url":"vendor/webaudio-tinysynth.min.js"},{"revision":"84f689d04c1d2e8148eb750b5c148e01","url":"assets/touch-rotate-landscape.webp"},{"revision":"d9eac686260af0982b222b311e7a496c","url":"assets/th07-card.webp"},{"revision":"e601ef032345731cb345ab1a530ab5ae","url":"assets/th06-card.webp"},{"revision":"12e4a24ed14c93f90d63920713c9106d","url":"assets/th07-title00.jpg"},{"revision":"ebe26b64ad7594878aee8ce22bab607d","url":"assets/th06-title00.jpg"},{"revision":"ede2634e1d70e53dca1f3ffa43e5e05a","url":"assets/notice-touhou-cloud.png"},{"revision":"b1f9a83b13113973a088b008013a14b4","url":"assets/notice-bilibili.svg"},{"revision":"13c59768c4177c1554b7d1d75b7ed58a","url":"assets/th06.ico"},{"revision":"2c2791a8a9e96b0b897131cd698b8f21","url":"assets/fonts/yatra-one-latin.woff2"},{"revision":"9ca350df601aec2e49603dc6fdc4c6cf","url":"assets/fonts/unifont-site.woff2"},{"revision":"bfcd1263285f0250b7911cad5f0a2a21","url":"assets/fonts/touhou98.woff2"},{"revision":"f26e03b2fc546c7bf682c0bd62e83bd5","url":"assets/fonts/noto-serif-sc-touhou.woff2"},{"revision":"baaacfff087041e2b5a7883c99a072c0","url":"assets/fonts/chill-round-gothic-site-medium.woff2"},{"revision":"a0bb58357a6d60e6516c7d9401b30285","url":"assets/fonts/chill-round-gothic-site-heavy.woff2"},{"revision":"59a2e04165dde9e4d166fdabb2efe228","url":"assets/fonts/chill-round-gothic-site-bold.woff2"},{"revision":"2017cbd70ba7674db9456c418d307f89","url":"./"}];
const cacheMetaUrl = new URL(`./__app-shell-meta__/ae9793261f7ea4ecfda7`, scopeUrl).href;

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
    build: "ae9793261f7ea4ecfda7",
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
