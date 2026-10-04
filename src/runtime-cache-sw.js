"use strict";

// One registered classic SW. Immutable public URLs do the version binding;
// private snapshots provide atomic offline preparation and whole-set fallback.
function createRuntimeCache({ scopeUrl, catalog, fetchTimeoutMs = 8000 }) {
  const C = EaglerRuntimeGenerations;
  const known = C.validateRuntimeManifest(catalog);
  const prefix = `eagler-touhou-runtime-v2-${encodeURIComponent(scopeUrl.pathname)}-`;
  const marker = new URL("./__runtime-cache-v2__/complete", scopeUrl).href;
  const inFlight = new Map(), protectedCaches = new Set();
  let cleanupSafe = true;
  const json = value => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
  const absolute = path => new URL(path, scopeUrl).href;
  function relative(url) {
    const parsed = new URL(url);
    if (parsed.origin !== scopeUrl.origin || !parsed.pathname.startsWith(scopeUrl.pathname)) return null;
    const path = parsed.pathname.slice(scopeUrl.pathname.length);
    return C.isRuntimePath(path) ? path : null;
  }
  async function sha256(bytes) {
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
  }
  async function verifyGeneration(raw) {
    const generation = C.validateRuntimeGeneration(raw);
    if (await sha256(new TextEncoder().encode(C.canonicalRuntimePayload(generation.entry, generation.files))) !== generation.generation) {
      throw new Error("Runtime generation identity mismatch");
    }
    return generation;
  }
  async function checked(response, file, progress) {
    if (!response?.ok) throw new Error(`Runtime file unavailable: ${file.path}`);
    const copy = response.clone();
    let bytes;
    if (!progress || !copy.body) bytes = await copy.arrayBuffer();
    else {
      const reader = copy.body.getReader(), chunks = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.byteLength) progress();
          length += value.byteLength;
          if (length > file.bytes) throw new Error(`Runtime integrity mismatch: ${file.path}`);
          chunks.push(value);
        }
      } finally { reader.cancel().catch(() => {}); reader.releaseLock(); }
      const combined = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
      bytes = combined.buffer;
    }
    if (bytes.byteLength !== file.bytes || await sha256(bytes) !== file.sha256) throw new Error(`Runtime integrity mismatch: ${file.path}`);
    return response;
  }
  async function network(url, read) {
    const controller = new AbortController();
    let timeout;
    const progress = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => controller.abort(new Error(`Runtime download stalled for ${fetchTimeoutMs} ms: ${url}`)), fetchTimeoutMs);
    };
    progress();
    try {
      const response = await fetch(new Request(url, { cache: "no-store", redirect: "error", signal: controller.signal }));
      if (!response.ok) throw new Error(`Runtime HTTP ${response.status}: ${url}`);
      progress();
      return await read(response, progress);
    } finally { clearTimeout(timeout); }
  }
  async function latest() {
    return network(absolute(C.RUNTIME_MANIFEST_FILE), async response => {
      const text = await response.text();
      if (text.length > 4 * 1024 * 1024) throw new Error("Runtime Manifest too large");
      return C.validateRuntimeManifest(JSON.parse(text));
    });
  }
  async function snapshots(root) {
    const result = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith(prefix)) continue;
      try {
        const raw = await (await (await caches.open(name)).match(marker))?.json();
        if (raw?.schema !== C.RUNTIME_CACHE_PROTOCOL || raw.complete !== true || !C.isRuntimeRoot(raw.root) ||
            (root && raw.root !== root)) continue;
        result.push({ ...raw, name, descriptor: await verifyGeneration(raw.descriptor) });
      } catch { /* An incomplete cache is never a committed generation. */ }
    }
    return result.sort((a, b) => Number(b.observedAt || b.createdAt) - Number(a.observedAt || a.createdAt));
  }
  async function complete(snapshot) {
    try {
      const cache = await caches.open(snapshot.name);
      const base = C.runtimeGenerationBase(snapshot.root, snapshot.descriptor.generation);
      for (const file of snapshot.descriptor.files) await checked(await cache.match(absolute(base + file.path)), file);
      return true;
    } catch { return false; }
  }
  async function stageBytes(root, raw, { localOnly = false, observedAt = 0, supplied } = {}) {
    const descriptor = await verifyGeneration(raw);
    const existing = await snapshots(root);
    for (const snapshot of existing) {
      if (snapshot.descriptor.generation !== descriptor.generation || !await complete(snapshot)) continue;
      if (observedAt > snapshot.observedAt) {
        snapshot.observedAt = observedAt;
        try { await (await caches.open(snapshot.name)).put(marker, json(snapshot)); }
        catch { /* A metadata write must not prevent using a complete set. */ }
      }
      return snapshot;
    }
    const nonce = Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join("-");
    const name = `${prefix}${encodeURIComponent(root)}-${descriptor.generation}-${nonce}`;
    const base = C.runtimeGenerationBase(root, descriptor.generation);
    const cache = await caches.open(name);
    const oldNames = (await caches.keys()).filter(name => name.startsWith("eagler-touhou-app-shell-"));
    let cursor = 0, stopped = false;
    try {
      await cache.put(marker, json({ schema: C.RUNTIME_CACHE_PROTOCOL, root, descriptor, complete: false, createdAt: Date.now() }));
      const writers = await Promise.allSettled(Array.from({ length: Math.min(2, descriptor.files.length) }, async () => {
        while (!stopped && cursor < descriptor.files.length) {
          try {
            const file = descriptor.files[cursor++];
            let response = supplied?.get(file.path) || null;
            if (response) await checked(response, file);
            for (const snapshot of existing) {
              if (response) break;
              const old = snapshot.descriptor.files.find(item => item.path === file.path && item.sha256 === file.sha256 && item.bytes === file.bytes);
              if (!old) continue;
              try { response = await checked(await (await caches.open(snapshot.name)).match(
                absolute(C.runtimeGenerationBase(root, snapshot.descriptor.generation) + file.path)), file); }
              catch { /* Try other verified bytes, not another version by URL. */ }
            }
            if (!response) for (const old of oldNames) {
              // A legacy cache may contain a poisoned JS/Wasm combination. The
              // current generation's actual hash, not its old label, is authority.
              try { response = await checked(await (await caches.open(old)).match(absolute(root + file.path)), file); break; }
              catch { /* Not a matching legacy byte sequence. */ }
            }
            if (!response && localOnly) throw new Error(`Runtime is not locally complete: ${file.path}`);
            response ||= await network(absolute(base + file.path), (response, progress) => checked(response, file, progress));
            await cache.put(absolute(base + file.path), response);
          } catch (error) { stopped = true; throw error; }
        }
      }));
      const failure = writers.find(result => result.status === "rejected");
      if (failure) throw failure.reason;
      const snapshot = { schema: C.RUNTIME_CACHE_PROTOCOL, root, descriptor, name,
        complete: true, createdAt: Date.now(), observedAt };
      // Atomic logical commit: all writers have completed before this marker.
      await cache.put(marker, json(snapshot));
      return snapshot;
    } catch (error) {
      await caches.delete(name).catch(() => {});
      throw error;
    }
  }
  async function stage(root, raw, options = {}) {
    const descriptor = C.validateRuntimeGeneration(raw);
    const key = root + descriptor.generation + (options.localOnly ? ":local" : ":network");
    // Coalesce only byte preparation of the SAME generation. Every launch must
    // still fetch its current pointer, even while an older download is running.
    if (!inFlight.has(key)) {
      const task = stageBytes(root, descriptor, options);
      inFlight.set(key, task);
      task.finally(() => { if (inFlight.get(key) === task) inFlight.delete(key); }).catch(() => {});
    }
    return inFlight.get(key);
  }
  async function select(path, options = {}) {
    let group, error;
    const excluded = new Set(options.exclude || []);
    try {
      const manifest = Object.hasOwn(options, "catalog")
        ? C.validateRuntimeManifest(options.catalog) : await latest();
      group = C.findRuntimeGroup(manifest, path);
      if (!group) throw new Error("Runtime is not published");
      if (!excluded.has(group.current.generation)) return await stage(group.root, group.current, { observedAt: Date.now() });
    } catch (cause) { error = cause; }
    group ||= C.findRuntimeGroup(known, path);
    if (group) {
      if (typeof migrateLegacyRuntimeSnapshots === "function") {
        await migrateLegacyRuntimeSnapshots({ scopeUrl, root: group.root, entry: group.current.entry, sha256,
          importSnapshot: (root, descriptor, supplied, observedAt) => stage(root, descriptor, { localOnly: true, supplied, observedAt }) });
      }
      for (const snapshot of await snapshots(group.root)) {
        if (!excluded.has(snapshot.descriptor.generation) && await complete(snapshot)) return snapshot;
      }
      // No usable local set: a retained complete server generation can still
      // recover a first visit when the current release is only partially present.
      for (const descriptor of group.previous) {
        if (excluded.has(descriptor.generation)) continue;
        try { return await stage(group.root, descriptor); } catch (cause) { error = cause; }
      }
      // Legacy per-file bytes can be reused only against a known whole set.
      if (!excluded.has(group.current.generation)) {
        try { return await stage(group.root, group.current, { localOnly: true }); }
        catch (cause) { error = cause; }
      }
    }
    // A publication might have completed during the first failed transaction.
    if (!options.noRetry) {
      try {
        const fresh = C.findRuntimeGroup(await latest(), path);
        if (fresh && !excluded.has(fresh.current.generation)) return await stage(fresh.root, fresh.current, { observedAt: Date.now() });
      } catch (cause) { error = cause; }
    }
    throw error || new Error("No complete Runtime is available");
  }
  async function prepare(path, options = {}) {
    return select(path, options);
  }
  async function collect(root) {
    if (!cleanupSafe) return;
    const all = await snapshots(root);
    const live = await self.clients.matchAll({ type: "all", includeUncontrolled: true });
    const active = new Set(live.map(client => {
      const path = relative(client.url);
      return path && C.parseRuntimeGenerationPath(path)?.generation;
    }).filter(Boolean));
    let retained = 0;
    for (const snapshot of all) {
      const keep = protectedCaches.has(snapshot.name) || active.has(snapshot.descriptor.generation) ||
        Date.now() - Math.max(snapshot.createdAt, snapshot.selectedAt || 0) < 60000;
      if (retained < 2 && await complete(snapshot)) { retained++; continue; }
      if (!keep) await caches.delete(snapshot.name);
    }
    for (const name of await caches.keys()) {
      if (!name.startsWith(prefix) || protectedCaches.has(name)) continue;
      try {
        const raw = await (await (await caches.open(name)).match(marker))?.json();
        if (raw?.schema === C.RUNTIME_CACHE_PROTOCOL && raw.root === root && raw.complete === false &&
            Date.now() - Number(raw.createdAt) > 600000) await caches.delete(name);
      } catch { /* Unknown caches are not ours to prune. */ }
    }
  }
  function deliver(response) {
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.delete("Content-Encoding"); headers.delete("Content-Length");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  async function immutableResponse(path, parsed) {
    for (const snapshot of await snapshots(parsed.root).catch(() => [])) {
      if (snapshot.descriptor.generation !== parsed.generation) continue;
      const file = snapshot.descriptor.files.find(file => file.path === parsed.file);
      if (!file) break;
      const cache = await caches.open(snapshot.name);
      const cached = await cache.match(absolute(path));
      if (cached) {
        try { return deliver(await checked(cached, file)); } catch { /* Repair this exact immutable address. */ }
      }
      const fetched = await network(absolute(path), response => checked(response, file));
      await cache.put(absolute(path), fetched.clone()).catch(() => {});
      return deliver(fetched);
    }
    // Explicit immutable requests never follow latest or change generation. In
    // a storage-restricted browser they remain ordinary same-origin HTTP loads.
    const group = known.groups.find(group => group.root === parsed.root);
    let descriptor = group && [group.current, ...group.previous].find(item => item.generation === parsed.generation);
    if (!descriptor) descriptor = await network(absolute(C.runtimeGenerationBase(parsed.root, parsed.generation) + C.RUNTIME_GENERATION_FILE), async response => {
      const raw = await response.json();
      if (raw.schema !== C.RUNTIME_GENERATION_SCHEMA || raw.protocol !== C.RUNTIME_PROTOCOL || raw.root !== parsed.root || raw.generation !== parsed.generation) {
        throw new Error("Immutable Runtime descriptor mismatch");
      }
      return verifyGeneration(raw);
    });
    descriptor = await verifyGeneration(descriptor);
    const file = descriptor.files.find(file => file.path === parsed.file);
    if (parsed.file === C.RUNTIME_GENERATION_FILE) return deliver(json({ schema: C.RUNTIME_GENERATION_SCHEMA,
      protocol: C.RUNTIME_PROTOCOL, root: parsed.root, ...descriptor }));
    if (!file) return new Response("Unknown Runtime resource", { status: 404 });
    return deliver(await network(absolute(path), response => checked(response, file)));
  }
  async function selectForLaunch(path, options) {
    const snapshot = await prepare(path, options);
    // A prior snapshot may be selected long after creation. Protect the gap
    // between replying to the Launcher and its new document becoming a client.
    snapshot.selectedAt = Date.now();
    try { await (await caches.open(snapshot.name)).put(marker, json(snapshot)); }
    catch { cleanupSafe = false; } // usable fallback wins over optional metadata/GC
    return snapshot;
  }
  function handle(event) {
    if (event.request.method !== "GET") return null;
    const path = relative(event.request.url);
    if (!path?.startsWith("runtime/")) return null;
    const parsed = C.parseRuntimeGenerationPath(path);
    if (parsed) return immutableResponse(path, parsed);
    if (event.request.mode !== "navigate" || !path.endsWith(".html")) return null;
    return (async () => {
      const snapshot = await selectForLaunch(path);
      protectedCaches.add(snapshot.name);
      try { await collect(snapshot.root); } catch { /* GC must never block a valid launch. */ }
      finally { protectedCaches.delete(snapshot.name); }
      const target = new URL(C.runtimeGenerationEntry(snapshot.root, snapshot.descriptor), scopeUrl);
      target.search = new URL(event.request.url).search;
      return new Response(null, { status: 302, headers: { Location: target.href, "Cache-Control": "no-store" } });
    })();
  }
  async function prepareLaunch(path, options) {
    const snapshot = await selectForLaunch(path, options);
    protectedCaches.add(snapshot.name);
    try { await collect(snapshot.root); } catch { /* Optional cleanup. */ }
    finally { protectedCaches.delete(snapshot.name); }
    return { ok: true, protocol: C.RUNTIME_CACHE_PROTOCOL, cached: true,
      entry: C.runtimeGenerationEntry(snapshot.root, snapshot.descriptor), generation: snapshot.descriptor.generation };
  }
  async function preparePaths(paths) {
    const groups = new Map();
    for (const path of paths) {
      const group = C.findRuntimeGroup(known, path) || known.groups.filter(group => path.startsWith(group.root)).sort((a, b) => b.root.length - a.root.length)[0];
      if (!group) throw new Error("Runtime is not declared: " + path);
      groups.set(group.root, group.root + group.current.entry);
    }
    for (const path of groups.values()) await prepare(path);
  }
  async function readyGroups() {
    const ready = new Set();
    for (const snapshot of await snapshots()) {
      if (!ready.has(snapshot.root) && await complete(snapshot)) ready.add(snapshot.root);
    }
    return [...ready].sort();
  }
  return { handle, prepareLaunch, preparePaths, readyGroups };
}
