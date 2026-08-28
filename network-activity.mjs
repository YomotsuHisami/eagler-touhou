function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return String(input || "");
}

function cloneTask(task) {
  return {
    id: task.id,
    url: task.url,
    title: task.title,
    label: task.label,
    kind: task.kind,
    phase: task.phase,
    loaded: task.loaded,
    total: task.total,
    startedAt: task.startedAt,
    updatedAt: task.updatedAt,
  };
}

export function createNetworkActivityTracker({
  fetchImpl = globalThis.fetch,
  xhrFactory = typeof globalThis.XMLHttpRequest === "function" ? () => new globalThis.XMLHttpRequest() : null,
  onChange = () => {},
  clock = nowMs,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
  if (typeof onChange !== "function") throw new TypeError("onChange must be a function");
  let serial = 0;
  const tasks = new Map();

  const snapshot = () => {
    const active = [...tasks.values()].map(cloneTask);
    return {
      active,
      count: active.length,
      loaded: active.reduce((sum, task) => sum + task.loaded, 0),
      total: active.every(task => task.total > 0)
        ? active.reduce((sum, task) => sum + task.total, 0)
        : 0,
    };
  };

  const emit = () => onChange(snapshot());

  function begin(meta = {}) {
    const id = `net-${Date.now().toString(36)}-${++serial}`;
    const startedAt = clock();
    tasks.set(id, {
      id,
      url: String(meta.url || ""),
      title: String(meta.title || "NETWORK REQUEST..."),
      label: String(meta.label || "SERVER REQUEST"),
      kind: String(meta.kind || "network"),
      phase: String(meta.phase || "requesting"),
      loaded: Math.max(0, Number(meta.loaded) || 0),
      total: Math.max(0, Number(meta.total) || 0),
      startedAt,
      updatedAt: startedAt,
    });
    emit();
    return id;
  }

  function update(id, patch = {}) {
    const task = tasks.get(id);
    if (!task) return false;
    if (patch.title != null) task.title = String(patch.title);
    if (patch.label != null) task.label = String(patch.label);
    if (patch.kind != null) task.kind = String(patch.kind);
    if (patch.phase != null) task.phase = String(patch.phase);
    if (patch.loaded != null) task.loaded = Math.max(0, Number(patch.loaded) || 0);
    if (patch.total != null) task.total = Math.max(0, Number(patch.total) || 0);
    task.updatedAt = clock();
    emit();
    return true;
  }

  function finish(id) {
    if (!tasks.delete(id)) return false;
    emit();
    return true;
  }

  async function trackedFetch(input, init = {}, meta = {}) {
    const url = requestUrl(input);
    const id = begin({ ...meta, url });
    try {
      const response = await fetchImpl(input, init);
      const total = Math.max(0, Number(response.headers?.get?.("content-length")) || 0);
      update(id, { phase: "receiving", total });

      const method = String(init?.method || (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
      if (!response.ok || method === "HEAD" || response.status === 204 || response.status === 205) {
        finish(id);
        return response;
      }

      // Keep the browser's native Response/body untouched. Re-wrapping a
      // Response.body with getReader() + a second ReadableStream works in
      // desktop Chrome, but can stall Android WebView/Via before the caller's
      // json()/blob() consumer sees any bytes. Track the lifetime through the
      // normal Response consumption methods instead.
      let settled = false;
      const settle = loaded => {
        if (settled) return;
        settled = true;
        const finalLoaded = Math.max(0, Number(loaded) || total || 0);
        update(id, { loaded: finalLoaded, total: total || finalLoaded, phase: "receiving" });
        finish(id);
      };
      const consumptionMethods = new Set(["arrayBuffer", "blob", "formData", "json", "text", "bytes"]);
      return new Proxy(response, {
        get(target, property) {
          if (property === "body") {
            // Direct stream consumers own their own progress loop. Do not
            // wrap the stream; end this generic owner rather than risking a
            // stale task or another WebView stream compatibility layer.
            settle(total);
            return Reflect.get(target, property, target);
          }
          const value = Reflect.get(target, property, target);
          if (!consumptionMethods.has(property) || typeof value !== "function") {
            return typeof value === "function" ? value.bind(target) : value;
          }
          return async (...args) => {
            try {
              const result = await value.apply(target, args);
              const loaded = result instanceof Blob ? result.size
                : result instanceof ArrayBuffer ? result.byteLength
                : ArrayBuffer.isView(result) ? result.byteLength
                : typeof result === "string" ? new TextEncoder().encode(result).byteLength
                : total;
              settle(loaded);
              return result;
            } catch (error) {
              finish(id);
              settled = true;
              throw error;
            }
          };
        },
      });
    } catch (error) {
      finish(id);
      throw error;
    }
  }

  function trackedXhrFetch(input, init = {}, meta = {}) {
    const method = String(init?.method || (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
    if (typeof xhrFactory !== "function" || !new Set(["GET", "HEAD"]).has(method) || init?.body != null) {
      return trackedFetch(input, init, meta);
    }
    const url = requestUrl(input);
    const id = begin({ ...meta, url });
    return new Promise((resolve, reject) => {
      const xhr = xhrFactory();
      let settled = false;
      const signal = init?.signal || null;
      const abortError = () => {
        if (typeof DOMException === "function") return new DOMException("已取消下载", "AbortError");
        const error = new Error("已取消下载");
        error.name = "AbortError";
        return error;
      };
      const cleanup = () => signal?.removeEventListener?.("abort", abort);
      const fail = error => {
        if (settled) return;
        settled = true;
        cleanup();
        finish(id);
        reject(error);
      };
      const abort = () => {
        try { xhr.abort(); } catch {}
        fail(abortError());
      };
      if (signal?.aborted) {
        fail(abortError());
        return;
      }
      try {
        xhr.open(method, url, true);
        xhr.responseType = "blob";
        xhr.withCredentials = init?.credentials === "include";
        if (init?.headers) {
          const headers = new Headers(init.headers);
          headers.forEach((value, name) => xhr.setRequestHeader(name, value));
        }
        xhr.onprogress = event => update(id, {
          phase: "receiving",
          loaded: event.loaded,
          total: event.lengthComputable ? event.total : 0,
        });
        xhr.onerror = () => fail(new TypeError(`${url}: network request failed`));
        xhr.ontimeout = () => fail(new TypeError(`${url}: network request timed out`));
        xhr.onabort = () => fail(abortError());
        xhr.onload = () => {
          if (settled) return;
          settled = true;
          cleanup();
          const blob = method === "HEAD" ? null : xhr.response;
          const loaded = blob instanceof Blob ? blob.size : 0;
          const total = Math.max(0, Number(xhr.getResponseHeader?.("content-length")) || loaded);
          update(id, { phase: "receiving", loaded, total });
          finish(id);
          const headers = new Headers();
          for (const line of String(xhr.getAllResponseHeaders?.() || "").trim().split(/[\r\n]+/)) {
            const split = line.indexOf(":");
            if (split > 0) headers.append(line.slice(0, split).trim(), line.slice(split + 1).trim());
          }
          resolve(new Response(blob, { status: xhr.status, statusText: xhr.statusText, headers }));
        };
        signal?.addEventListener?.("abort", abort, { once: true });
        xhr.send();
      } catch (error) {
        fail(error);
      }
    });
  }

  return {
    begin,
    update,
    finish,
    fetch: trackedFetch,
    xhrFetch: trackedXhrFetch,
    snapshot,
    get activeCount() { return tasks.size; },
  };
}
