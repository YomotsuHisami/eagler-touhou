export type NetworkDiagnosticKind = "ws" | "turn" | "nat" | "ipv6";

export interface NetworkDiagnosticResult {
  kind: NetworkDiagnosticKind;
  good: boolean;
  value: string;
}

export interface NetworkDiagnosticsStateOptions {
  getRelayUrl: () => string;
  getFallbackIceServers: () => RTCIceServer[];
  translate: (key: NetworkDiagnosticMessageKey, params?: Record<string, string | number>) => string;
}

export interface NetworkDiagnosticsControllerOptions extends NetworkDiagnosticsStateOptions {
  button: HTMLButtonElement;
  panel: HTMLElement;
}

export interface NetworkDiagnosticsSnapshot {
  readonly hidden: boolean;
  readonly running: boolean;
  readonly rows: Readonly<Record<NetworkDiagnosticKind, {
    readonly state: "pending" | "good" | "bad";
    readonly value: string;
  }>>;
}

const diagnosticKinds = ["ws", "turn", "nat", "ipv6"] as const;
// Match main's untouched initial markup. Translation remains lazy: only an
// explicit run requests checking/result copy from the current locale callback.
export const initialNetworkDiagnosticsSnapshot: NetworkDiagnosticsSnapshot = Object.freeze({
  hidden: true, running: false,
  rows: Object.freeze(Object.fromEntries(diagnosticKinds.map(kind => [kind,
    Object.freeze({state: "pending", value: "检测中…"}),
  ])) as NetworkDiagnosticsSnapshot["rows"]),
});

export type NetworkDiagnosticMessageKey =
  | "networkCheck.checking"
  | "networkCheck.wsLatency"
  | "networkCheck.turnLatency"
  | "networkCheck.failed"
  | "networkCheck.unavailable"
  | "networkCheck.ipv6Available"
  | "networkCheck.ipv6Unavailable";

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

async function probeDiagnosticRelay(url: string, timeoutMs: number): Promise<RelayProbe> {
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
    const configuration = await ready;
    clearTimeout(timer);
    const samples: number[] = [];
    for (let index = 0; index < 3; index++) {
      const nonce = `${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`;
      const sentAt = performance.now();
      const receivedAt = await new Promise<number>((resolve, reject) => {
        const pingTimer = globalThis.setTimeout(() => {
          pongWaiters.delete(nonce);
          reject(timeoutError("WebSocket ping"));
        }, 2000);
        pongWaiters.set(nonce, value => { clearTimeout(pingTimer); resolve(value); });
        socket.send(JSON.stringify({ type: "diagnostic-ping", nonce }));
      });
      samples.push(receivedAt - sentAt);
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

async function probeLegacyRelay(url: string, timeoutMs: number): Promise<RelayProbe> {
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
    return await ready;
  } finally {
    clearTimeout(timer);
    try { socket.close(1000, "diagnostic complete"); } catch {}
  }
}

export async function probeRelay(url: string, timeoutMs = 6000): Promise<RelayProbe> {
  try {
    return await probeDiagnosticRelay(url, Math.min(timeoutMs, 3000));
  } catch {
    // Relays deployed before the dedicated diagnostic endpoint still expose
    // their real ICE configuration through the normal signaling handshake.
    // A unique room/run keeps this compatibility probe isolated from users.
    return probeLegacyRelay(url, timeoutMs);
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

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 8000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", changed);
      resolve();
    };
    const changed = () => { if (pc.iceGatheringState === "complete") finish(); };
    const timer = globalThis.setTimeout(finish, timeoutMs);
    pc.addEventListener("icegatheringstatechange", changed);
  });
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

async function gatherCandidates(servers: RTCIceServer[]): Promise<CandidateSummary[]> {
  const pc = new RTCPeerConnection({ iceServers: stunServers(servers) });
  const candidates: CandidateSummary[] = [];
  pc.addEventListener("icecandidate", event => { if (event.candidate) candidates.push(candidateSummary(event.candidate)); });
  try {
    pc.createDataChannel("network-check");
    await pc.setLocalDescription(await pc.createOffer());
    await waitForIceGathering(pc);
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

function waitForDataChannel(channel: RTCDataChannel, timeoutMs = 12000): Promise<void> {
  if (channel.readyState === "open") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => finish(timeoutError("TURN data channel")), timeoutMs);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      channel.removeEventListener("open", opened);
      channel.removeEventListener("error", failed);
      if (error) reject(error); else resolve();
    };
    const opened = () => finish();
    const failed = () => finish(new Error("TURN data channel failed"));
    channel.addEventListener("open", opened);
    channel.addEventListener("error", failed);
  });
}

async function probeTurnLatency(servers: RTCIceServer[]): Promise<number> {
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
    await left.setLocalDescription(await left.createOffer());
    await waitForIceGathering(left, 12000);
    if (!/\styp relay\s/i.test(left.localDescription?.sdp || "")) throw new Error("TURN allocation failed");
    await right.setRemoteDescription(left.localDescription as RTCSessionDescription);
    await right.setLocalDescription(await right.createAnswer());
    await waitForIceGathering(right, 12000);
    if (!/\styp relay\s/i.test(right.localDescription?.sdp || "")) throw new Error("TURN allocation failed");
    await left.setRemoteDescription(right.localDescription as RTCSessionDescription);
    await waitForDataChannel(channel);
    if (!await selectedPairUsesTurn(left)) throw new Error("TURN route was not selected");
    const samples: number[] = [];
    for (let index = 0; index < 3; index++) {
      const nonce = `turn-${Date.now().toString(36)}-${index}`;
      const sentAt = performance.now();
      const receivedAt = await new Promise<number>((resolve, reject) => {
        const timer = globalThis.setTimeout(() => finish(undefined, timeoutError("TURN ping")), 2500);
        const finish = (event?: MessageEvent, error?: Error) => {
          if (event && event.data !== nonce) return;
          clearTimeout(timer);
          channel.removeEventListener("message", received);
          if (error) reject(error); else resolve(performance.now());
        };
        const received = (event: MessageEvent) => finish(event);
        channel.addEventListener("message", received);
        channel.send(nonce);
      });
      samples.push(receivedAt - sentAt);
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

/** Shared probe state. It owns no DOM and starts IO only on run(). Probe
 * algorithms, run ordering and native timeout/finally cleanup remain main's. */
export function createNetworkDiagnosticsState(options: NetworkDiagnosticsStateOptions) {
  let running = false;
  let snapshot = initialNetworkDiagnosticsSnapshot;
  const listeners = new Set<() => void>();
  const publish = (next: NetworkDiagnosticsSnapshot) => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };
  const pending = () => {
    const rows = Object.freeze(Object.fromEntries(diagnosticKinds.map(kind => [kind,
      Object.freeze({state: "pending", value: options.translate("networkCheck.checking")}),
    ])) as NetworkDiagnosticsSnapshot["rows"]);
    publish({hidden: false, running: true, rows});
  };
  const settle = ({kind, good, value}: NetworkDiagnosticResult) => {
    const state = good ? "good" : "bad";
    if (snapshot.rows[kind].state === state && snapshot.rows[kind].value === value) return;
    publish({...snapshot, rows: Object.freeze({...snapshot.rows, [kind]: Object.freeze({state, value})})});
  };

  async function run() {
    if (running) return;
    running = true;
    pending();
    try {
      const relayUrl = options.getRelayUrl();
      const fallbackIceServers = options.getFallbackIceServers();
      const candidatesPromise = gatherCandidates(fallbackIceServers);
      let relay: RelayProbe | null = null;
      try {
        relay = await probeRelay(relayUrl);
        settle({ kind: "ws", good: relay.latencyMs < 180, value: options.translate("networkCheck.wsLatency", { latency: relay.latencyMs }) });
      } catch {
        settle({ kind: "ws", good: false, value: options.translate("networkCheck.failed") });
      }

      const turnPromise = relay ? probeTurnLatency(relay.iceServers).then(latency => {
        settle({ kind: "turn", good: latency < 180, value: options.translate("networkCheck.turnLatency", { latency }) });
      }).catch(error => {
        settle({ kind: "turn", good: false, value: options.translate(String(error).includes("unavailable") ? "networkCheck.unavailable" : "networkCheck.failed") });
      }) : Promise.resolve(settle({ kind: "turn", good: false, value: options.translate("networkCheck.unavailable") }));

      try {
        const candidates = await candidatesPromise;
        const nat = classifyNat(candidates);
        settle({ kind: "nat", good: !!nat && nat !== "NAT4", value: nat || options.translate("networkCheck.failed") });
        const ipv6 = ipv6Available(candidates);
        settle({ kind: "ipv6", good: ipv6, value: options.translate(ipv6 ? "networkCheck.ipv6Available" : "networkCheck.ipv6Unavailable") });
      } catch {
        settle({ kind: "nat", good: false, value: options.translate("networkCheck.failed") });
        settle({ kind: "ipv6", good: false, value: options.translate("networkCheck.ipv6Unavailable") });
      }
      await turnPromise;
    } finally {
      running = false;
      publish({...snapshot, running: false});
    }
  }

  return Object.freeze({
    run, isRunning: () => running, getSnapshot: () => snapshot,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
  });
}

/** Original main's API remains a presentation adapter over the shared state. */
export function createNetworkDiagnosticsController(options: NetworkDiagnosticsControllerOptions) {
  const rows = new Map<NetworkDiagnosticKind, HTMLElement>();
  for (const kind of diagnosticKinds) {
    const row = options.panel.querySelector<HTMLElement>(`[data-network-result="${kind}"]`);
    if (!row) throw new Error(`Network diagnostics row is missing: ${kind}`);
    rows.set(kind, row);
  }
  const state = createNetworkDiagnosticsState(options);
  let previous = state.getSnapshot();
  state.subscribe(() => {
    const snapshot = state.getSnapshot();
    if (snapshot.hidden !== previous.hidden || snapshot.running && !previous.running) options.panel.hidden = snapshot.hidden;
    for (const [kind, row] of rows) {
      if (snapshot.rows[kind] === previous.rows[kind]) continue;
      row.dataset.state = snapshot.rows[kind].state;
      const output = row.querySelector<HTMLOutputElement>("output");
      if (output) output.value = snapshot.rows[kind].value;
    }
    if (snapshot.running !== previous.running) {
      if (snapshot.running) {
        options.button.classList.add("running");
        options.button.setAttribute("aria-disabled", "true");
      } else {
        options.button.classList.remove("running");
        options.button.removeAttribute("aria-disabled");
      }
    }
    previous = snapshot;
  });
  options.button.addEventListener("click", () => { void state.run(); });
  return Object.freeze({run: state.run, isRunning: state.isRunning});
}
