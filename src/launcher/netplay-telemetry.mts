interface Peer { pc?: { getStats(): Promise<RTCStatsReport> } | null }
export interface TelemetrySnapshot {
  identity: object;
  product: string;
  players: number;
  spectator: boolean;
  transport: string;
  peers: Iterable<[number, Peer]>;
}
interface Counter {
  pair: string;
  path: "direct" | "turn";
  tx: number;
  rx: number;
  txPackets: number;
  rxPackets: number;
}
export interface TelemetryRecord {
  version: 1;
  id: string;
  seq: number;
  product: string;
  players: number;
  role: "player" | "spectator";
  automated: boolean;
  seconds: number;
  route: "direct" | "turn" | "mixed" | "websocket" | "unknown";
  links: Array<{ path: "direct" | "turn"; seconds: number; tx: number; rx: number; txPackets: number; rxPackets: number }>;
}

/** Same-origin, deployment-enabled counters. No names, addresses or persistent IDs. */
export function createNetplayTelemetry(options: {
  endpoint(): unknown;
  snapshot(): TelemetrySnapshot | null;
  origin: string;
  now?: () => number;
  id?: () => string;
  send?: (url: string, record: TelemetryRecord) => Promise<unknown>;
}) {
  const now = options.now ?? Date.now;
  const send = options.send ?? ((url, data) => fetch(url, {
    method: "POST", body: JSON.stringify(data), headers: { "Content-Type": "application/json" },
    credentials: "omit", cache: "no-store", keepalive: true, signal: AbortSignal.timeout(5000),
  }));
  let identity: object | null = null, id = "", seq = 0, at = 0, nextAt = 0, busy = false;
  let previous = new Map<number, Counter>();
  async function tick() {
    if (busy || now() < nextAt) return;
    busy = true;
    try {
      const endpoint = options.endpoint();
      if (typeof endpoint !== "string" || !endpoint) return;
      const url = new URL(endpoint, options.origin);
      if (url.origin !== new URL(options.origin).origin || !/^https?:$/.test(url.protocol)) return;
      const snapshot = options.snapshot();
      if (!snapshot) { identity = null; previous.clear(); return; }
      const startedAt = now();
      if (identity !== snapshot.identity) {
        identity = snapshot.identity; id = (options.id ?? (() => crypto.randomUUID()))();
        seq = 0; at = startedAt; previous.clear();
      }
      const current = new Map<number, Counter>();
      if (!snapshot.spectator && snapshot.transport === "rtc") {
        for (const [peerId, peer] of snapshot.peers) {
          try {
            const stats = await peer.pc?.getStats();
            if (!stats) continue;
            let pair: Record<string, unknown> | undefined;
            stats.forEach((entry: RTCStats & Record<string, unknown>) => {
              if (entry.type === "transport" && typeof entry.selectedCandidatePairId === "string") pair = stats.get(entry.selectedCandidatePairId);
            });
            if (!pair) continue;
            if ([pair.bytesSent, pair.bytesReceived].some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0)) continue;
            const local = stats.get(String(pair.localCandidateId)), remote = stats.get(String(pair.remoteCandidateId));
            if (!local?.candidateType || !remote?.candidateType) continue;
            const count = (name: string) => typeof pair![name] === "number" && Number.isFinite(pair![name]) ? pair![name] as number : 0;
            current.set(peerId, { pair: String(pair.id), path: local.candidateType === "relay" || remote.candidateType === "relay" ? "turn" : "direct",
              tx: count("bytesSent"), rx: count("bytesReceived"), txPackets: count("packetsSent"), rxPackets: count("packetsReceived") });
          } catch { /* A closed or recovering peer must not affect gameplay. */ }
        }
      }
      // Discard background suspension and candidate changes instead of extrapolating.
      const seconds = seq > 0 && startedAt > at && startedAt - at <= 90000 ? (startedAt - at) / 1000 : 0;
      const links: TelemetryRecord["links"] = [];
      for (const [peer, counter] of current) {
        const old = previous.get(peer);
        if (!old || old.pair !== counter.pair || old.path !== counter.path || !seconds || counter.tx < old.tx || counter.rx < old.rx) continue;
        links.push({ path: counter.path, seconds, tx: counter.tx - old.tx, rx: counter.rx - old.rx,
          txPackets: Math.max(0, counter.txPackets - old.txPackets), rxPackets: Math.max(0, counter.rxPackets - old.rxPackets) });
      }
      const paths = new Set([...current.values()].map(value => value.path));
      const route: TelemetryRecord["route"] = snapshot.spectator || snapshot.transport === "relay" ? "websocket"
        : current.size !== snapshot.players - 1 || (seconds > 0 && links.length !== snapshot.players - 1) ? "unknown"
        : paths.size > 1 ? "mixed" : [...paths][0] ?? "unknown";
      const record: TelemetryRecord = { version: 1, id, seq: ++seq, product: snapshot.product, players: snapshot.players,
        role: snapshot.spectator ? "spectator" : "player", automated: globalThis.navigator?.webdriver === true, seconds, route, links };
      previous = current; at = startedAt; nextAt = startedAt + 15000;
      await send(url.href, record).catch(() => {});
    } catch { /* Statistics are optional and never a launch gate. */ }
    finally { busy = false; }
  }
  return { tick };
}
