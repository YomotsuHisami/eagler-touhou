import json
import sys
from playwright.sync_api import sync_playwright


URL = sys.argv[1] if len(sys.argv) > 1 else "https://test.touhou.vip/eagler-touhou/"


PROBE = r"""async () => {
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const signalUrl = new URL("/eagler-netplay/", location.href);
  signalUrl.protocol = "wss:";
  signalUrl.searchParams.set("room", `turnprobe-${nonce}`);
  signalUrl.searchParams.set("run", "1");
  signalUrl.searchParams.set("player", "0");
  signalUrl.searchParams.set("players", "2");
  signalUrl.searchParams.set("signal", "1");
  const iceServers = await new Promise((resolve, reject) => {
    const socket = new WebSocket(signalUrl);
    const timer = setTimeout(() => { socket.close(); reject(new Error("TURN credential timeout")); }, 8000);
    socket.onmessage = event => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.type !== "peers") return;
      clearTimeout(timer);
      socket.close();
      resolve((message.iceServers || []).filter(server => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        return urls.some(url => /^turns?:/i.test(String(url || "")));
      }));
    };
    socket.onerror = () => { clearTimeout(timer); reject(new Error("TURN signaling error")); };
  });
  if (!iceServers.length) throw new Error("TURN server list is empty");

  const config = { iceServers, iceTransportPolicy: "relay", bundlePolicy: "max-bundle" };
  const a = new RTCPeerConnection(config);
  const b = new RTCPeerConnection(config);
  const reliable = a.createDataChannel("quality-control", { ordered: true });
  const input = a.createDataChannel("quality-input", { ordered: false, maxRetransmits: 0 });
  let reliablePeer = null;
  let inputPeer = null;
  let inputReceived = 0;
  b.ondatachannel = event => {
    if (event.channel.label === "quality-control") {
      reliablePeer = event.channel;
      reliablePeer.onmessage = message => reliablePeer.send(message.data);
    } else if (event.channel.label === "quality-input") {
      inputPeer = event.channel;
      inputPeer.onmessage = () => { inputReceived++; };
    }
  };
  const gathered = pc => new Promise(resolve => {
    if (pc.iceGatheringState === "complete") return resolve();
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") resolve();
    });
  });
  const opened = channel => new Promise((resolve, reject) => {
    if (channel.readyState === "open") return resolve();
    const timer = setTimeout(() => reject(new Error(`${channel.label} open timeout`)), 15000);
    channel.onopen = () => { clearTimeout(timer); resolve(); };
    channel.onerror = () => { clearTimeout(timer); reject(new Error(`${channel.label} error`)); };
  });
  try {
    await a.setLocalDescription(await a.createOffer());
    await gathered(a);
    await b.setRemoteDescription(a.localDescription);
    await b.setLocalDescription(await b.createAnswer());
    await gathered(b);
    await a.setRemoteDescription(b.localDescription);
    await Promise.all([opened(reliable), opened(input)]);

    const rtts = [];
    let resolver = null;
    reliable.onmessage = () => { const done = resolver; resolver = null; done?.(); };
    for (let index = 0; index < 90; index++) {
      const started = performance.now();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { resolver = null; reject(new Error("TURN ping timeout")); }, 2000);
        resolver = () => { clearTimeout(timer); resolve(); };
        reliable.send(new Uint8Array(128));
      });
      rtts.push(performance.now() - started);
      await new Promise(resolve => setTimeout(resolve, 16));
    }

    const inputSent = 180;
    for (let index = 0; index < inputSent; index++) {
      input.send(new Uint8Array(192));
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    await new Promise(resolve => setTimeout(resolve, 750));

    const stats = await a.getStats();
    let pair = null;
    for (const report of stats.values()) {
      if (report.type === "transport" && report.selectedCandidatePairId) pair = stats.get(report.selectedCandidatePairId);
    }
    if (!pair) for (const report of stats.values()) {
      if (report.type === "candidate-pair" && report.nominated && report.state === "succeeded") { pair = report; break; }
    }
    const local = pair ? stats.get(pair.localCandidateId) : null;
    const remote = pair ? stats.get(pair.remoteCandidateId) : null;
    const deltas = rtts.slice(1).map((value, index) => Math.abs(value - rtts[index]));
    const sortedRtts = [...rtts].sort((x, y) => x - y);
    const percentile = value => sortedRtts[Math.min(sortedRtts.length - 1, Math.floor((sortedRtts.length - 1) * value))];
    return {
      localType: local?.candidateType || null,
      remoteType: remote?.candidateType || null,
      protocol: local?.protocol || null,
      relayProtocol: local?.relayProtocol || null,
      pairRttMs: pair?.currentRoundTripTime != null ? pair.currentRoundTripTime * 1000 : null,
      p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: sortedRtts.at(-1),
      meanDeltaMs: deltas.reduce((sum, value) => sum + value, 0) / Math.max(1, deltas.length),
      inputSent, inputReceived, inputLost: inputSent - inputReceived,
      availableOutgoingBitrate: pair?.availableOutgoingBitrate || null,
    };
  } finally {
    a.close(); b.close();
  }
}"""


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto(URL, wait_until="domcontentloaded", timeout=20000)
    result = page.evaluate(PROBE)
    browser.close()

print(json.dumps(result, ensure_ascii=False))
