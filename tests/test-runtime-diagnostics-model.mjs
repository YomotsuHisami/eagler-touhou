import assert from "node:assert/strict";
import { appendRttSample, compactDiagnosticText, compactNetplayPeerStatus, compactRendererLabel, describeBrowserEnvironment, describeNetplayConnection, runtimeDiagnosticsVisibleByDefault, selectedRtcPair }
  from "../.cache/build/browser/assets/launcher/runtime-diagnostics-model.mjs";

assert.equal(runtimeDiagnosticsVisibleByDefault(true, true), true);
for (const [testBuild, launched] of [[false, true], [true, false], ["true", true], [true, 1]]) {
  assert.equal(runtimeDiagnosticsVisibleByDefault(testBuild, launched), false);
}
assert.equal(runtimeDiagnosticsVisibleByDefault(false, true, true), true);
assert.equal(runtimeDiagnosticsVisibleByDefault(true, true, false), false);
assert.equal(runtimeDiagnosticsVisibleByDefault(false, true, false), false);
assert.equal(compactDiagnosticText("  A   B  ", 8), "A B");
assert.equal(compactDiagnosticText("123456789", 8), "1234567…");
assert.equal([...compactDiagnosticText("显卡参数非常非常长", 6)].length, 6);

const webView = describeBrowserEnvironment({
  userAgent: "Mozilla/5.0 (Linux; Android 16; RMX5080 Build/TEST; wv) AppleWebKit/537.36 Version/4.0 Chrome/151.0.7922.137 Mobile Safari/537.36",
});
assert.equal(webView.browser, "Android WebView 151.0.7922.137");
assert.match(webView.ua, /Chromium 151\.0\.7922\.137 \/ Android 16 \/ WebView/);
const brave = describeBrowserEnvironment({ userAgent: "Mozilla/5.0 Chrome/151.0.7922.137 Safari/537.36", userAgentDataPlatform: "Windows", brave: true });
assert.equal(brave.browser, "Brave 151.0.7922.137");
const safari = describeBrowserEnvironment({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1" });
assert.equal(safari.browser, "Safari 18.6");
assert.match(safari.ua, /WebKit 18\.6 \/ iOS 18\.6 \/ 移动端/);

assert.equal(compactRendererLabel("ANGLE (Google, Mali-G720 MC7, OpenGL ES 3.2)"), "Mali-G720 MC7");
assert.equal(compactRendererLabel("  Apple   M4  "), "Apple M4");
assert.equal(compactRendererLabel(""), "--");

const preferredPair = { type: "candidate-pair", id: "pair-a", state: "succeeded", currentRoundTripTime: 0.02 };
const stats = new Map([
  ["transport", { type: "transport", selectedCandidatePairId: "pair-a" }],
  ["pair-a", preferredPair],
  ["pair-b", { type: "candidate-pair", nominated: true, state: "succeeded" }],
]);
assert.equal(selectedRtcPair(stats), preferredPair);
assert.equal(selectedRtcPair(new Map([["pair-b", stats.get("pair-b")]]))?.type, "candidate-pair");
assert.equal(selectedRtcPair(new Map()), null);

let quality = { samples: [] };
for (const value of [10, 20, 30, 40, 100]) quality = appendRttSample(quality.samples, value);
assert.deepEqual(quality.samples, [10, 20, 30, 40, 100]);
assert.equal(quality.variationMs, 10);
for (let value = 0; value < 30; value++) quality = appendRttSample(quality.samples, value);
assert.equal(quality.samples.length, 20);
assert.equal(compactNetplayPeerStatus({ player: 1, route: "direct", rttMs: 42.4, variationMs: 3.6 }), "P2 direct 42/4ms");
assert.equal(compactNetplayPeerStatus({ player: 2, route: "turn", rttMs: 55.2 }), "P3 turn 55ms");
assert.equal(compactNetplayPeerStatus({ player: 1, route: "relay" }), "P2 relay --ms");
assert.equal(compactNetplayPeerStatus({ player: 1, route: "direct", connected: false, rttMs: 20 }), "P2 reconnecting");

const rtcPeers = new Map([
  [1, { pc: { connectionState: "connected" }, inputOpen: true, controlOpen: true }],
]);
const rtcReady = describeNetplayConnection({
  peerState: { peers: rtcPeers }, transport: "rtc", path: "direct", playerCount: 2, localPlayer: 0,
});
assert.equal(rtcReady.hidden, true);
assert.equal(rtcReady.connectedOnce, true);
assert.equal(rtcReady.showRouteWarning, false);

const reconnecting = describeNetplayConnection({
  peerState: { peers: new Map([[1, { pc: { connectionState: "disconnected" }, inputOpen: false, controlOpen: false }]]) },
  transport: "rtc", path: "direct", playerCount: 2, localPlayer: 0, connectedOnce: true,
});
assert.equal(reconnecting.hidden, false);
assert.equal(reconnecting.reconnecting, true);
assert.equal(reconnecting.title, "正在重新连接…");
assert.equal(reconnecting.summary, "");
assert.equal(reconnecting.peerRows[0].status, "连接中");
assert.equal(reconnecting.peerRows[0].detail, "");

const relayReady = describeNetplayConnection({
  peerState: { relay: { readyState: 1 } }, transport: "relay", path: "relay", playerCount: 2, localPlayer: 0,
});
assert.equal(relayReady.hidden, true);
assert.equal(relayReady.showRouteWarning, false);
assert.equal(relayReady.warning, "");

const spectatorFailed = describeNetplayConnection({
  spectator: true, failed: true, error: "closed", peerState: { relay: { readyState: 3 } }, webSocketOpenState: 1,
});
assert.equal(spectatorFailed.hidden, false);
assert.equal(spectatorFailed.reconnecting, true);
assert.equal(spectatorFailed.title, "旁观连接已断开");
assert.equal(spectatorFailed.summary, "closed");

console.log(JSON.stringify({ runtimeDiagnosticsModel: "PASS", visibility: "test-build-default-or-user-toggle", lineLimit: 96, browserDetection: 3, renderer: "compact", rtcPair: "selected", rttWindow: 20, connectionWindow: "modeled" }));
