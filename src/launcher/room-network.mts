/** Lobby-only probes. These connections never carry input or join a Runtime run. */
export type ProbeLane = "direct" | "turn" | "relay";
export interface ProbeMetric { rtt: number | null; jitter: number | null; state: "checking" | "connected" | "unavailable"; at: number }
interface Link { pc: RTCPeerConnection; channel?: RTCDataChannel; token: string; pending: RTCIceCandidateInit[]; outbound: RTCIceCandidateInit[]; signaled: boolean; started: number }
interface Peer { id: string; started: number; metrics: Record<ProbeLane, ProbeMetric>; links: Partial<Record<"direct" | "turn", Link>>; pings: Map<string, { lane: ProbeLane; at: number }> }
const emptyMetric = (): ProbeMetric => ({ rtt: null, jitter: null, state: "checking", at: 0 });
export function recordProbeSample(metric: ProbeMetric, elapsed: number, now: number): ProbeMetric {
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 10000) return metric;
  return { rtt: elapsed, jitter: metric.rtt == null ? null : Math.abs(elapsed - metric.rtt), state: "connected", at: now };
}
export function freshProbeMetric(metric: ProbeMetric, now: number): ProbeMetric {
  return metric.state === "connected" && now - metric.at > 8000 ? { ...metric, rtt: null, jitter: null, state: "unavailable" } : metric;
}
export function createRoomNetwork(options: { send: (message: Record<string, unknown>) => boolean; changed: () => void }) {
  const peers = new Map<string, Peer>();
  const minimumRtts = new Map<string, number>();
  let localId = "", enabled = false, supported = false, servers: RTCIceServer[] = [], timer = 0, serial = 0;
  const send = (to: string, lane: ProbeLane, payload: Record<string, unknown>) => options.send({ type: "room-probe", to, lane, ...payload });
  const current = (peer: Peer, lane: "direct" | "turn", link: Link) => enabled && peers.get(peer.id) === peer && peer.links[lane] === link;
  const closePeer = (peer: Peer) => {
    for (const link of Object.values(peer.links)) { link.channel?.close(); link.pc.close(); }
    peer.pings.clear();
  };
  const clear = () => { clearInterval(timer); timer = 0; enabled = false; for (const peer of peers.values()) closePeer(peer); peers.clear(); };
  const received = (peer: Peer, lane: ProbeLane, data: unknown, reply: (value: string) => void) => {
    if (typeof data !== "string" || data.length > 200) return;
    const [kind, nonce] = data.split(":");
    if (kind === "ping" && nonce) { reply(`pong:${nonce}`); return; }
    const ping = peer.pings.get(nonce);
    if (kind !== "pong" || !ping || ping.lane !== lane) return;
    peer.pings.delete(nonce);
    const elapsed = performance.now() - ping.at;
    peer.metrics[lane] = recordProbeSample(peer.metrics[lane], elapsed, performance.now());
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 10000)
      minimumRtts.set(peer.id, Math.min(minimumRtts.get(peer.id) ?? Infinity, elapsed));
    options.changed();
  };
  const bind = (peer: Peer, lane: "direct" | "turn", link: Link, channel: RTCDataChannel) => {
    if (!current(peer, lane, link)) { channel.close(); return; }
    link.channel = channel;
    channel.onmessage = event => { if (current(peer, lane, link)) received(peer, lane, event.data, value => channel.readyState === "open" && channel.send(value)); };
    channel.onopen = () => tick();
    channel.onclose = () => { if (current(peer, lane, link)) { peer.metrics[lane] = { ...emptyMetric(), state: "unavailable" }; options.changed(); } };
  };
  const signalDescription = (peer: Peer, lane: "direct" | "turn", link: Link) => {
    if (!current(peer, lane, link)) return;
    const description = link.pc.localDescription?.toJSON();
    if (!description || !send(peer.id, lane, { token: link.token, description })) throw new Error("room probe signaling unavailable");
    // WebSocket preserves message order. Send the description before any ICE
    // candidates gathered during setLocalDescription, so the receiver has a
    // link with the matching token when those candidates arrive.
    link.signaled = true;
    for (const candidate of link.outbound.splice(0)) {
      if (!current(peer, lane, link)) break;
      send(peer.id, lane, { token: link.token, candidate });
    }
  };
  const createLink = (peer: Peer, lane: "direct" | "turn", token: string): Link | null => {
    const urlsFor = (server: RTCIceServer) => (typeof server.urls === "string" ? [server.urls] : server.urls).filter(url => lane === "turn" ? /^turns?:/i.test(url) : /^stuns?:/i.test(url));
    const iceServers = servers.map(server => ({ ...server, urls: urlsFor(server) })).filter(server => server.urls.length);
    if (typeof RTCPeerConnection !== "function" || (lane === "turn" && !iceServers.length)) {
      peer.metrics[lane].state = "unavailable"; return null;
    }
    peer.links[lane]?.pc.close();
    const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: lane === "turn" ? "relay" : "all" });
    const link: Link = { pc, token, pending: [], outbound: [], signaled: false, started: performance.now() };
    peer.links[lane] = link;
    pc.onicecandidate = event => {
      if (!event.candidate || !current(peer, lane, link)) return;
      const candidate = event.candidate.toJSON();
      if (link.signaled) send(peer.id, lane, { token, candidate });
      else if (link.outbound.length < 64) link.outbound.push(candidate);
    };
    pc.ondatachannel = event => bind(peer, lane, link, event.channel);
    pc.onconnectionstatechange = () => {
      if (current(peer, lane, link) && ["failed", "disconnected", "closed"].includes(pc.connectionState)) {
        peer.metrics[lane] = { ...emptyMetric(), state: "unavailable" }; options.changed();
      }
    };
    return link;
  };
  const offer = async (peer: Peer, lane: "direct" | "turn") => {
    try {
      const link = createLink(peer, lane, crypto.randomUUID());
      if (!link) return;
      bind(peer, lane, link, link.pc.createDataChannel("room-latency"));
      await link.pc.setLocalDescription(await link.pc.createOffer());
      signalDescription(peer, lane, link);
    } catch { if (peers.get(peer.id) === peer) { peer.metrics[lane].state = "unavailable"; options.changed(); } }
  };
  const tick = () => {
    if (!enabled) return;
    const now = performance.now();
    for (const peer of peers.values()) {
      for (const [nonce, ping] of peer.pings) if (now - ping.at > 8000) { peer.pings.delete(nonce); peer.metrics[ping.lane] = { ...emptyMetric(), state: "unavailable" }; }
      for (const lane of ["direct", "turn", "relay"] as const) {
        const link = lane === "relay" ? undefined : peer.links[lane];
        if (lane !== "relay" && link?.channel?.readyState !== "open" && now - (link?.started ?? peer.started) > 12000) peer.metrics[lane].state = "unavailable";
        if (lane !== "relay" && link?.channel?.readyState !== "open") continue;
        const nonce = String(++serial);
        peer.pings.set(nonce, { lane, at: now });
        if (lane === "relay") send(peer.id, lane, { echo: `ping:${nonce}` });
        else link!.channel!.send(`ping:${nonce}`);
      }
    }
    options.changed();
  };
  const update = (input: { localId: string; peers: string[]; active: boolean }) => {
    if (!input.active || !supported) { if (enabled) clear(); return; }
    if (localId !== input.localId) { clear(); minimumRtts.clear(); }
    localId = input.localId; enabled = true;
    for (const [id, peer] of peers) if (!input.peers.includes(id)) { peers.delete(id); closePeer(peer); }
    for (const id of input.peers) {
      if (id === localId || peers.has(id)) continue;
      const peer: Peer = { id, started: performance.now(), metrics: { direct: emptyMetric(), turn: emptyMetric(), relay: emptyMetric() }, links: {}, pings: new Map() };
      peers.set(id, peer);
      if (!servers.some(server => (typeof server.urls === "string" ? [server.urls] : server.urls).some(url => /^turns?:/i.test(url)))) peer.metrics.turn.state = "unavailable";
      if (localId < id) { void offer(peer, "direct"); void offer(peer, "turn"); }
    }
    if (!timer) { timer = window.setInterval(tick, 2500); tick(); }
  };
  const receive = async (message: Record<string, unknown>) => {
    if (message.type === "room-probe-config") {
      supported = true;
      servers = Array.isArray(message.iceServers) ? message.iceServers as RTCIceServer[] : [];
      return;
    }
    if (message.type !== "room-probe" || !enabled) return;
    const peer = peers.get(String(message.from));
    const lane = message.lane;
    if (!peer || !["direct", "turn", "relay"].includes(String(lane))) return;
    if (lane === "relay") { received(peer, lane, message.echo, echo => send(peer.id, lane, { echo })); return; }
    if (lane !== "direct" && lane !== "turn" || typeof message.token !== "string") return;
    if (message.restart === true && localId < peer.id) { void offer(peer, lane); return; }
    try {
      const description = message.description as RTCSessionDescriptionInit | undefined;
      let link = peer.links[lane];
      if (description?.type === "offer" && localId > peer.id) {
        link = createLink(peer, lane, message.token) ?? undefined;
        if (!link) return;
      }
      if (!link || link.token !== message.token) return;
      if (description) {
        await link.pc.setRemoteDescription(description);
        if (!current(peer, lane, link)) return;
        for (const candidate of link.pending.splice(0)) await link.pc.addIceCandidate(candidate);
        if (description.type === "offer") {
          await link.pc.setLocalDescription(await link.pc.createAnswer());
          signalDescription(peer, lane, link);
        }
      } else if (message.candidate) {
        if (link.pc.remoteDescription) await link.pc.addIceCandidate(message.candidate as RTCIceCandidateInit);
        else if (link.pending.length < 64) link.pending.push(message.candidate as RTCIceCandidateInit);
      }
    } catch { if (peers.get(peer.id) === peer) { peer.metrics[lane].state = "unavailable"; options.changed(); } }
  };
  return { update, receive, retry: (peerId?: string) => {
    for (const peer of peers.values()) {
      if (peerId && peer.id !== peerId) continue;
      if (localId > peer.id) for (const lane of ["direct", "turn"] as const) send(peer.id, lane, { token: crypto.randomUUID(), restart: true });
      if (peerId) { peers.delete(peer.id); closePeer(peer); }
    }
    if (!peerId) clear();
  }, suspend: clear, reset: (preserveMinimum = false) => {
    clear(); supported = false; servers = [];
    if (!preserveMinimum) minimumRtts.clear();
  },
    minimumRtt: (ids: readonly string[]): number | null => {
      const values = ids.flatMap(id => minimumRtts.has(id) ? [minimumRtts.get(id)!] : []);
      return values.length ? Math.max(...values) : null;
    },
    capabilities: () => ({
      supported,
      rtcAvailable: typeof RTCPeerConnection === "function",
      turnConfigured: servers.some(server => (typeof server.urls === "string" ? [server.urls] : server.urls).some(url => /^turns?:/i.test(url))),
    }),
    metric: (id: string, lane: ProbeLane) => freshProbeMetric(peers.get(id)?.metrics[lane] ?? { ...emptyMetric(), state: supported ? "checking" : "unavailable" }, performance.now()),
  };
}
