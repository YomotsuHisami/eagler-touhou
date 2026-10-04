export type NetworkDiagnosticKind = "ws" | "turn" | "nat" | "ipv6";

export interface NetworkDiagnosticResult {
  kind: NetworkDiagnosticKind;
  good: boolean;
  value: string;
}

export interface NetworkDiagnosticsControllerOptions {
  button: HTMLButtonElement;
  panel: HTMLElement;
  getRelayUrl: () => string;
  getFallbackIceServers: () => RTCIceServer[];
  translate: (key: NetworkDiagnosticMessageKey, params?: Record<string, string | number>) => string;
}

export type NetworkDiagnosticMessageKey =
  | "networkCheck.checking"
  | "networkCheck.wsLatency"
  | "networkCheck.turnLatency"
  | "networkCheck.failed"
  | "networkCheck.unavailable"
  | "networkCheck.ipv6Available"
  | "networkCheck.ipv6Unavailable";

/** Structured values keep an in-flight check independent of the display locale. */
export interface NetworkDiagnosticMeasurement {
  kind: NetworkDiagnosticKind;
  good: boolean;
  message?: NetworkDiagnosticMessageKey;
  params?: Record<string, string | number>;
  value?: string;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Network check cancelled", "AbortError");
}
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {signal.removeEventListener("abort", aborted);reject(new DOMException("Network check cancelled", "AbortError"));};
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
    if (signal.aborted) aborted();
  });
}

type CandidateSummary = {
  type: RTCIceCandidateType | "";
  address: string;
  port: number;
  relatedAddress: string;
  relatedPort: number;
};

type RelayProbe = {
  latencyMs: number;
  iceServers: RTCIceServer[];
};

const DIAGNOSTIC_STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
];

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)] ?? 0;
}

function timeoutError(label: string): Error {
  return new Error(`${label} timeout`);
}

function websocketMessage(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

function validIceServers(value: unknown): RTCIceServer[] {
  if (!Array.isArray(value)) return [];
  return value.filter(item => {
    if (!item || typeof item !== "object") return false;
    const urls = (item as RTCIceServer).urls;
    return typeof urls === "string" || (Array.isArray(urls) && urls.every(url => typeof url === "string"));
  }) as RTCIceServer[];
}

async function probeDiagnosticRelay(url: string, timeoutMs: number, signal?: AbortSignal): Promise<RelayProbe> {
  checkAbort(signal);
  const socket = new WebSocket(url);
  const pongWaiters = new Map<string, (receivedAt: number) => void>();
  let readyResolve: ((value: { iceServers: RTCIceServer[] }) => void) | null = null;
  let readyReject: ((reason: unknown) => void) | null = null;
  const ready = new Promise<{ iceServers: RTCIceServer[] }>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const timer = globalThis.setTimeout(() => readyReject?.(timeoutError("WebSocket")), timeoutMs);
  socket.addEventListener("message", event => {
    const message = websocketMessage(event.data);
    if (!message) return;
    if (message.type === "diagnostic-ready") {
      readyResolve?.({ iceServers: validIceServers(message.iceServers) });
      return;
    }
    if (message.type === "diagnostic-pong" && typeof message.nonce === "string") {
      pongWaiters.get(message.nonce)?.(performance.now());
      pongWaiters.delete(message.nonce);
    }
  });
  socket.addEventListener("error", () => readyReject?.(new Error("WebSocket connection failed")));
  socket.addEventListener("close", () => readyReject?.(new Error("WebSocket closed")));
  try {
    const configuration = await abortable(ready, signal);
    clearTimeout(timer);
    const samples: number[] = [];
    for (let index = 0; index < 3; index++) {
      checkAbort(signal);
      const nonce = `${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`;
      const sentAt = performance.now();
      let pingTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const receivedAt = await abortable(new Promise<number>((resolve, reject) => {
          pingTimer = globalThis.setTimeout(() => reject(timeoutError("WebSocket ping")), 2000);
          pongWaiters.set(nonce, resolve);
          socket.send(JSON.stringify({ type: "diagnostic-ping", nonce }));
        }), signal);
        samples.push(receivedAt - sentAt);
      } finally { clearTimeout(pingTimer); pongWaiters.delete(nonce); }
    }
    return { ...configuration, latencyMs: Math.max(1, Math.round(median(samples))) };
  } finally {
    clearTimeout(timer);
    pongWaiters.clear();
    try { socket.close(1000, "diagnostic complete"); } catch {}
  }
}

export function legacyDiagnosticRelayUrl(value: string, nonce: string): string {
  const url = new URL(value);
  for (const key of ["diagnostic", "room", "run", "lobby", "player", "players", "signal", "spectator"])
    url.searchParams.delete(key);
  // Old relay deployments predate the dedicated ?diagnostic=1 endpoint and
  // require an ordinary signaling room. Keep that compatibility probe product
  // neutral: network health is a shared Multiplayer service concern, not a
  // title-specific capability.
  url.searchParams.set("room", `diagnostic-${nonce}`.slice(0, 64));
  url.searchParams.set("run", nonce.slice(0, 64));
  url.searchParams.set("player", "0");
  url.searchParams.set("players", "2");
  url.searchParams.set("signal", "1");
  return url.href;
}

async function probeLegacyRelay(url: string, timeoutMs: number, signal?: AbortSignal): Promise<RelayProbe> {
  checkAbort(signal);
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const startedAt = performance.now();
  const socket = new WebSocket(legacyDiagnosticRelayUrl(url, nonce));
  let readyResolve: ((value: RelayProbe) => void) | null = null;
  let readyReject: ((reason: unknown) => void) | null = null;
  const ready = new Promise<RelayProbe>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const timer = globalThis.setTimeout(() => readyReject?.(timeoutError("WebSocket signaling")), timeoutMs);
  socket.addEventListener("message", event => {
    const message = websocketMessage(event.data);
    if (message?.type !== "peers") return;
    readyResolve?.({
      latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
      iceServers: validIceServers(message.iceServers),
    });
  });
  socket.addEventListener("error", () => readyReject?.(new Error("WebSocket signaling failed")));
  socket.addEventListener("close", () => readyReject?.(new Error("WebSocket signaling closed")));
  try {
    return await abortable(ready, signal);
  } finally {
    clearTimeout(timer);
    try { socket.close(1000, "diagnostic complete"); } catch {}
  }
}

export async function probeRelay(url: string, timeoutMs = 6000, signal?: AbortSignal): Promise<RelayProbe> {
  try {
    return await probeDiagnosticRelay(url, Math.min(timeoutMs, 3000), signal);
  } catch {
    checkAbort(signal);
    // Relays deployed before the dedicated diagnostic endpoint still expose
    // their real ICE configuration through the normal signaling handshake.
    // A unique room/run keeps this compatibility probe isolated from users.
    return probeLegacyRelay(url, timeoutMs, signal);
  }
}

function candidateSummary(candidate: RTCIceCandidate): CandidateSummary {
  const fields = candidate.candidate.trim().split(/\s+/);
  const typeIndex = fields.indexOf("typ");
  const relatedAddressIndex = fields.indexOf("raddr");
  const relatedPortIndex = fields.indexOf("rport");
  return {
    type: candidate.type || (typeIndex >= 0 ? fields[typeIndex + 1] as RTCIceCandidateType : ""),
    address: candidate.address || fields[4] || "",
    port: Number(candidate.port || fields[5]) || 0,
    relatedAddress: candidate.relatedAddress || (relatedAddressIndex >= 0 ? fields[relatedAddressIndex + 1] : "") || "",
    relatedPort: Number(candidate.relatedPort || (relatedPortIndex >= 0 ? fields[relatedPortIndex + 1] : 0)) || 0,
  };
}

async function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 8000, signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  if (pc.iceGatheringState === "complete") return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let changed = () => {};
  try {
    await abortable(new Promise<void>(resolve => {
      changed = () => { if (pc.iceGatheringState === "complete") resolve(); };
      timer = globalThis.setTimeout(resolve, timeoutMs);
      pc.addEventListener("icegatheringstatechange", changed);
    }), signal);
  } finally {
    clearTimeout(timer);
    pc.removeEventListener("icegatheringstatechange", changed);
  }
}

function serverUrls(server: RTCIceServer): string[] {
  return typeof server.urls === "string" ? [server.urls] : [...server.urls];
}

function stunServers(servers: RTCIceServer[]): RTCIceServer[] {
  const configured = servers.filter(server => serverUrls(server).some(url => /^stuns?:/i.test(url)));
  const known = new Set(configured.flatMap(serverUrls).map(url => url.toLowerCase()));
  return [...configured, ...DIAGNOSTIC_STUN_SERVERS.filter(server => !serverUrls(server).some(url => known.has(url.toLowerCase())))];
}

function turnServers(servers: RTCIceServer[]): RTCIceServer[] {
  return servers.filter(server => serverUrls(server).some(url => /^turns?:/i.test(url)));
}

async function gatherCandidates(servers: RTCIceServer[], signal?: AbortSignal): Promise<CandidateSummary[]> {
  checkAbort(signal);
  const pc = new RTCPeerConnection({ iceServers: stunServers(servers) });
  const candidates: CandidateSummary[] = [];
  pc.addEventListener("icecandidate", event => { if (event.candidate) candidates.push(candidateSummary(event.candidate)); });
  try {
    pc.createDataChannel("network-check");
    await abortable(pc.setLocalDescription(await abortable(pc.createOffer(), signal)), signal);
    await waitForIceGathering(pc, 8000, signal);
    return candidates;
  } finally {
    pc.close();
  }
}

function ipv4Address(address: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(address);
}

function privateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
}

function globalIpv6(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  if (!normalized.includes(":") || normalized.endsWith(".local") || normalized === "::" || normalized === "::1") return false;
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return false;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("::ffff:")) return false;
  return true;
}

export function classifyNat(candidates: CandidateSummary[]): "NAT1" | "NAT3" | "NAT4" | null {
  if (candidates.some(candidate => candidate.type === "host" && ipv4Address(candidate.address) && !privateIpv4(candidate.address))) return "NAT1";
  const reflexive = candidates.filter(candidate => candidate.type === "srflx" && ipv4Address(candidate.address));
  const mappings = new Map<string, Set<string>>();
  for (const candidate of reflexive) {
    if (!candidate.relatedAddress || !candidate.relatedPort) continue;
    const source = `${candidate.relatedAddress}:${candidate.relatedPort}`;
    const mapped = `${candidate.address}:${candidate.port}`;
    if (!mappings.has(source)) mappings.set(source, new Set());
    mappings.get(source)?.add(mapped);
  }
  if ([...mappings.values()].some(mapped => mapped.size > 1)) return "NAT4";
  // Without a server-reflexive candidate the browser has not supplied enough
  // evidence to distinguish restrictive NAT from blocked/failed STUN.
  return reflexive.length ? "NAT3" : null;
}

function ipv6Available(candidates: CandidateSummary[]): boolean {
  return candidates.some(candidate => candidate.type === "srflx" && globalIpv6(candidate.address));
}

async function selectedPairUsesTurn(pc: RTCPeerConnection): Promise<boolean> {
  const report = await pc.getStats();
  let selectedPairId = "";
  report.forEach(stat => {
    if (stat.type === "transport" && typeof stat.selectedCandidatePairId === "string") selectedPairId = stat.selectedCandidatePairId;
  });
  let pair = selectedPairId ? report.get(selectedPairId) : null;
  if (!pair) report.forEach(stat => {
    if (!pair && stat.type === "candidate-pair" && stat.state === "succeeded" && stat.nominated === true) pair = stat;
  });
  if (!pair) return false;
  const local = report.get(String(pair.localCandidateId || ""));
  const remote = report.get(String(pair.remoteCandidateId || ""));
  return local?.candidateType === "relay" && remote?.candidateType === "relay";
}

async function waitForDataChannel(channel: RTCDataChannel, timeoutMs = 12000, signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  if (channel.readyState === "open") return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let opened = () => {}, failed = () => {};
  try {
    await abortable(new Promise<void>((resolve, reject) => {
      opened = resolve;
      failed = () => reject(new Error("TURN data channel failed"));
      timer = globalThis.setTimeout(() => reject(timeoutError("TURN data channel")), timeoutMs);
      channel.addEventListener("open", opened);
      channel.addEventListener("error", failed);
      channel.addEventListener("close", failed);
    }), signal);
  } finally {
    clearTimeout(timer);
    channel.removeEventListener("open", opened);
    channel.removeEventListener("error", failed);
    channel.removeEventListener("close", failed);
  }
}

async function probeTurnLatency(servers: RTCIceServer[], signal?: AbortSignal): Promise<number> {
  checkAbort(signal);
  const relayServers = turnServers(servers);
  if (!relayServers.length) throw new Error("TURN unavailable");
  const configuration: RTCConfiguration = { iceServers: relayServers, iceTransportPolicy: "relay" };
  const left = new RTCPeerConnection(configuration);
  const right = new RTCPeerConnection(configuration);
  const channel = left.createDataChannel("network-check");
  right.addEventListener("datachannel", event => {
    event.channel.addEventListener("message", message => event.channel.send(message.data));
  });
  try {
    await abortable(left.setLocalDescription(await abortable(left.createOffer(), signal)), signal);
    await waitForIceGathering(left, 12000, signal);
    if (!/\styp relay\s/i.test(left.localDescription?.sdp || "")) throw new Error("TURN allocation failed");
    await abortable(right.setRemoteDescription(left.localDescription as RTCSessionDescription), signal);
    await abortable(right.setLocalDescription(await abortable(right.createAnswer(), signal)), signal);
    await waitForIceGathering(right, 12000, signal);
    if (!/\styp relay\s/i.test(right.localDescription?.sdp || "")) throw new Error("TURN allocation failed");
    await abortable(left.setRemoteDescription(right.localDescription as RTCSessionDescription), signal);
    await waitForDataChannel(channel, 12000, signal);
    if (!await abortable(selectedPairUsesTurn(left), signal)) throw new Error("TURN route was not selected");
    const samples: number[] = [];
    for (let index = 0; index < 3; index++) {
      checkAbort(signal);
      const nonce = `turn-${Date.now().toString(36)}-${index}`;
      const sentAt = performance.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let received = (_event: MessageEvent) => {};
      try {
        const receivedAt = await abortable(new Promise<number>((resolve, reject) => {
          timer = globalThis.setTimeout(() => reject(timeoutError("TURN ping")), 2500);
          received = event => { if (event.data === nonce) resolve(performance.now()); };
          channel.addEventListener("message", received);
          channel.send(nonce);
        }), signal);
        samples.push(receivedAt - sentAt);
      } finally { clearTimeout(timer); channel.removeEventListener("message", received); }
    }
    return turnServerLatencyFromLoopback(median(samples));
  } finally {
    try { channel.close(); } catch {}
    left.close();
    right.close();
  }
}

export function turnServerLatencyFromLoopback(peerRoundTripMs: number): number {
  // Both endpoints are in this browser and both are forced through the same
  // TURN service. Their echoed DataChannel RTT therefore contains two equal
  // client-to-TURN round trips, whereas the displayed WebSocket number
  // contains one. Normalize that deliberate loopback topology only after the
  // relay-to-relay candidate pair and payload echo have both been proven.
  return Math.max(1, Math.round(Math.max(0, peerRoundTripMs) / 2));
}

/** One shared probe pipeline for both the legacy adapter and React views.
 * Cancellation closes temporary sockets/peers; this never joins a user room. */
export async function runNetworkDiagnostics({relayUrl, fallbackIceServers = [], signal, onResult}: {
  relayUrl: string;
  fallbackIceServers?: RTCIceServer[];
  signal?: AbortSignal;
  onResult: (result: NetworkDiagnosticMeasurement) => void;
}): Promise<void> {
  checkAbort(signal);
  const settle = (result: NetworkDiagnosticMeasurement) => { if (!signal?.aborted) onResult(result); };
  // Install failure handlers immediately: unavailable WebRTC must not become
  // an unhandled rejection while a slower WebSocket handshake is pending.
  const candidates = gatherCandidates(fallbackIceServers, signal).then(values => {
    const nat = classifyNat(values);
    settle({kind: "nat", good: !!nat && nat !== "NAT4", ...(nat ? {value: nat} : {message: "networkCheck.failed" as const})});
    const ipv6 = ipv6Available(values);
    settle({kind: "ipv6", good: ipv6, message: ipv6 ? "networkCheck.ipv6Available" : "networkCheck.ipv6Unavailable"});
  }, () => {
    settle({kind: "nat", good: false, message: "networkCheck.failed"});
    settle({kind: "ipv6", good: false, message: "networkCheck.ipv6Unavailable"});
  });
  const server = (async () => {
    let relay: RelayProbe;
    try {
      relay = await probeRelay(relayUrl, 6000, signal);
      settle({kind: "ws", good: relay.latencyMs < 180, message: "networkCheck.wsLatency", params: {latency: relay.latencyMs}});
    } catch {
      settle({kind: "ws", good: false, message: "networkCheck.failed"});
      settle({kind: "turn", good: false, message: "networkCheck.unavailable"});
      return;
    }
    try {
      const latency = await probeTurnLatency(relay.iceServers, signal);
      settle({kind: "turn", good: latency < 180, message: "networkCheck.turnLatency", params: {latency}});
    } catch (error) {
      settle({kind: "turn", good: false, message: String(error).includes("unavailable") ? "networkCheck.unavailable" : "networkCheck.failed"});
    }
  })();
  await Promise.all([candidates, server]);
  checkAbort(signal);
}

export function createNetworkDiagnosticsController(options: NetworkDiagnosticsControllerOptions) {
  const rows = new Map<NetworkDiagnosticKind, HTMLElement>();
  for (const kind of ["ws", "turn", "nat", "ipv6"] as const) {
    const row = options.panel.querySelector<HTMLElement>(`[data-network-result="${kind}"]`);
    if (!row) throw new Error(`Network diagnostics row is missing: ${kind}`);
    rows.set(kind, row);
  }
  let running = false;

  const pending = () => {
    options.panel.hidden = false;
    for (const row of rows.values()) {
      row.dataset.state = "pending";
      const output = row.querySelector<HTMLOutputElement>("output");
      if (output) output.value = options.translate("networkCheck.checking");
    }
  };
  const settle = ({ kind, good, value }: NetworkDiagnosticResult) => {
    const row = rows.get(kind);
    if (!row) return;
    row.dataset.state = good ? "good" : "bad";
    const output = row.querySelector<HTMLOutputElement>("output");
    if (output) output.value = value;
  };

  async function run() {
    if (running) return;
    running = true;
    pending();
    options.button.classList.add("running");
    options.button.setAttribute("aria-disabled", "true");
    try {
      await runNetworkDiagnostics({relayUrl: options.getRelayUrl(), fallbackIceServers: options.getFallbackIceServers(),
        onResult: result => settle({kind: result.kind, good: result.good,
          value: result.message ? options.translate(result.message, result.params) : result.value || ""})});
    } finally {
      running = false;
      options.button.classList.remove("running");
      options.button.removeAttribute("aria-disabled");
    }
  }

  options.button.addEventListener("click", () => { void run(); });
  return Object.freeze({ run, isRunning: () => running });
}
