import {
  RUNTIME_MANIFEST_FILE, RUNTIME_CAPABILITIES, RUNTIME_PREPARE, RUNTIME_CACHE_PROTOCOL,
  RUNTIME_CACHE_MAX_PREVIOUS, canonicalRuntimePayload, findRuntimeGroup,
  runtimeGenerationBase, runtimeGenerationEntry, validateRuntimeManifest, parseRuntimeGenerationPath,
  type RuntimeManifest,
} from "../contracts/runtime-generations.mjs";

export interface PreparedRuntime {
  url: string;
  generation: string;
  cached: boolean;
}
interface WorkerLike { postMessage(message: unknown, transfer: Transferable[]): void; }
interface LaunchOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  worker?: WorkerLike | null | PromiseLike<WorkerLike | null>;
  exclude?: readonly string[];
  timeoutMs?: number;
}
async function digest(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    byte => byte.toString(16).padStart(2, "0")).join("");
}
async function bounded<T>(task: PromiseLike<T>, timeout: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(task).catch(() => fallback), new Promise<T>(resolve => {
      timer = setTimeout(() => resolve(fallback), timeout);
    })]);
  } finally { clearTimeout(timer); }
}
async function message(worker: WorkerLike, data: unknown, timeout: number): Promise<Record<string, unknown> | null> {
  const channel = new MessageChannel();
  try {
    return await bounded(new Promise<Record<string, unknown> | null>(resolve => {
      channel.port1.onmessage = event => resolve(event.data as Record<string, unknown>);
      worker.postMessage(data, [channel.port2]);
    }), timeout, null);
  } finally { channel.port1.close(); channel.port2.close(); }
}
async function activeWorker(base: string): Promise<WorkerLike | null> {
  try { return (await navigator.serviceWorker?.getRegistration(base))?.active || null; }
  catch { return null; }
}
/** The current pointer is fetched at invocation, not after SW registration or
 * activation. Every successful result is one immutable entry, never a wrapper
 * iframe or a set of mutable URLs. Storage restrictions still allow HTTP use. */
export async function prepareRuntimeLaunch(runtime: string, {
  baseUrl = new URL("./", globalThis.location.href).href,
  fetchImpl = globalThis.fetch.bind(globalThis), worker, exclude = [], timeoutMs = 8000,
}: LaunchOptions = {}): Promise<PreparedRuntime> {
  const base = new URL("./", baseUrl);
  const requested = new URL(runtime, base);
  if (requested.origin !== base.origin || !requested.pathname.startsWith(base.pathname)) {
    throw new Error("Published Runtime entry is outside the Launcher mount");
  }
  const path = requested.pathname.slice(base.pathname.length);
  if (exclude.length > RUNTIME_CACHE_MAX_PREVIOUS + 1 || exclude.some(id => !/^[a-f0-9]{64}$/.test(id))) {
    throw new Error("Invalid Runtime fallback exclusions");
  }
  async function network<T>(url: string, read: (response: Response) => Promise<T>, retries = 0): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, { cache: "no-store", redirect: "error", signal: controller.signal });
        if (!response.ok) throw new Error(`Runtime HTTP ${response.status}: ${url}`);
        return await read(response);
      } catch (error) {
        if (!controller.signal.aborted && !(error instanceof TypeError)) throw error;
        lastError = error;
      } finally { clearTimeout(timer); }
      if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
    }
    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`Runtime request failed after ${retries + 1} attempts: ${url} (${reason})`);
  }
  const manifestTask: Promise<RuntimeManifest | null> = network(new URL(RUNTIME_MANIFEST_FILE, base).href, async response => {
    const text = await response.text();
    if (text.length > 4 * 1024 * 1024) throw new Error("Runtime Manifest exceeds size limit");
    return validateRuntimeManifest(JSON.parse(text));
  }).catch(() => null);
  const workerTask = bounded(Promise.resolve(worker === undefined ? activeWorker(base.href) : worker), 5000, null);
  const [manifest, target] = await Promise.all([manifestTask, workerTask]);
  if (target) {
    const capability = await message(target, { type: RUNTIME_CAPABILITIES }, 2000);
    if (capability?.ok && capability.protocol === RUNTIME_CACHE_PROTOCOL) {
      const result = await message(target, { type: RUNTIME_PREPARE, entry: path,
        ...(manifest ? { catalog: manifest } : {}), exclude: [...exclude] }, 120000);
      if (result?.ok && result.protocol === RUNTIME_CACHE_PROTOCOL && typeof result.entry === "string" &&
          typeof result.generation === "string") {
        const selected = new URL(result.entry, base);
        const identity = parseRuntimeGenerationPath(selected.pathname.slice(base.pathname.length));
        const requestedRoot = parseRuntimeGenerationPath(path)?.root || (manifest && findRuntimeGroup(manifest, path)?.root) || path.slice(0, path.lastIndexOf("/") + 1);
        if (selected.origin !== base.origin || !selected.pathname.startsWith(base.pathname) ||
            !identity || identity.generation !== result.generation || identity.root !== requestedRoot ||
            !identity.file.endsWith(".html") || exclude.includes(result.generation)) {
          throw new Error("Invalid Runtime preparation response");
        }
        selected.search = requested.search; selected.searchParams.delete("v"); selected.hash = requested.hash;
        return { url: selected.href, generation: result.generation, cached: result.cached === true };
      }
      // A quota/permission failure must not make a working online generation
      // unusable. Continue with verified ordinary immutable HTTP below.
    }
  }
  const group = manifest && findRuntimeGroup(manifest, path);
  if (!group) throw new Error("Runtime is unavailable online and no complete offline copy was prepared");
  let lastError: unknown;
  for (const descriptor of [group.current, ...group.previous]) {
    if (exclude.includes(descriptor.generation)) continue;
    try {
      const actual = await digest(new TextEncoder().encode(canonicalRuntimePayload(descriptor.entry, descriptor.files)).buffer);
      if (actual !== descriptor.generation) throw new Error("Runtime generation identity mismatch");
      const directory = runtimeGenerationBase(group.root, descriptor.generation);
      // No cache authority is available. Verify this complete set first; normal
      // subsequent HTTP requests still address immutable, never latest, files.
      for (const file of descriptor.files) await network(new URL(directory + file.path, base).href, async response => {
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== file.bytes || await digest(bytes) !== file.sha256) throw new Error(`Runtime integrity mismatch: ${file.path}`);
      }, 2);
      const selected = new URL(runtimeGenerationEntry(group.root, descriptor), base);
      selected.search = requested.search; selected.searchParams.delete("v"); selected.hash = requested.hash;
      return { url: selected.href, generation: descriptor.generation, cached: false };
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error("No complete Runtime is available");
}
