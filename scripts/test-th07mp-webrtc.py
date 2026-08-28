import secrets
import sys

from playwright.sync_api import sync_playwright


def selected_candidate_summary(page):
    return page.evaluate("""async () => {
      const state = globalThis.__th07PeerTransport;
      const peer = state ? [...state.peers.values()][0] : null;
      if (!peer?.pc) return null;
      const stats = await peer.pc.getStats();
      let pair = null;
      for (const report of stats.values()) {
        if (report.type === 'transport' && report.selectedCandidatePairId)
          pair = stats.get(report.selectedCandidatePairId);
      }
      if (!pair) {
        for (const report of stats.values()) {
          if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
            pair = report;
            break;
          }
        }
      }
      if (!pair) return null;
      const local = stats.get(pair.localCandidateId);
      const remote = stats.get(pair.remoteCandidateId);
      return {
        localType: local?.candidateType || null,
        remoteType: remote?.candidateType || null,
        protocol: local?.protocol || null,
      };
    }""")


def run_group(browser, harness, room, run, *, player_count=2, disable_webrtc=False,
              expected_mode="rtc", delay_rtc_route_player=None, hanging_signal_player=None,
              exercise_recovery=False):
    context = browser.new_context()
    if disable_webrtc:
        context.add_init_script("Object.defineProperty(globalThis, 'RTCPeerConnection', { configurable: true, value: undefined });")
    pages = [context.new_page() for _ in range(player_count)]
    if exercise_recovery:
        for page in pages:
            page.add_init_script("""
              (() => {
                const NativePeerConnection = globalThis.RTCPeerConnection;
                class RecoveryTestPeerConnection extends NativePeerConnection {
                  get connectionState() { return this.__forcedConnectionState || super.connectionState; }
                  get iceConnectionState() { return this.__forcedIceState || super.iceConnectionState; }
                  restartIce() {
                    globalThis.__iceRestartCalls = (globalThis.__iceRestartCalls || 0) + 1;
                    this.__forcedConnectionState = null;
                    this.__forcedIceState = null;
                    return super.restartIce();
                  }
                  __forceIceState(state) {
                    this.__forcedConnectionState = state;
                    this.__forcedIceState = state;
                    this.dispatchEvent(new Event('connectionstatechange'));
                    this.dispatchEvent(new Event('iceconnectionstatechange'));
                  }
                  __clearForcedIceState() {
                    this.__forcedConnectionState = null;
                    this.__forcedIceState = null;
                    this.dispatchEvent(new Event('connectionstatechange'));
                    this.dispatchEvent(new Event('iceconnectionstatechange'));
                  }
                }
                globalThis.__iceRestartCalls = 0;
                globalThis.RTCPeerConnection = RecoveryTestPeerConnection;
              })();
            """)
    if delay_rtc_route_player is not None:
        pages[delay_rtc_route_player].add_init_script("""
          (() => {
            const NativeWebSocket = globalThis.WebSocket;
            class DelayedRouteWebSocket extends NativeWebSocket {
              constructor(...args) {
                super(...args);
                this.__eaglerRouteReplay = false;
                this.addEventListener('message', event => {
                  if (this.__eaglerRouteReplay || typeof event.data !== 'string') return;
                  let message;
                  try { message = JSON.parse(event.data); } catch { return; }
                  if (message?.type !== 'route' || message?.mode !== 'rtc') return;
                  event.stopImmediatePropagation();
                  const data = event.data;
                  setTimeout(() => {
                    this.__eaglerRouteReplay = true;
                    this.dispatchEvent(new MessageEvent('message', { data }));
                    this.__eaglerRouteReplay = false;
                  }, 300);
                }, true);
              }
            }
            globalThis.WebSocket = DelayedRouteWebSocket;
          })();
        """)
    if hanging_signal_player is not None:
        pages[hanging_signal_player].add_init_script("""
          (() => {
            const NativeWebSocket = globalThis.WebSocket;
            class HangingSignalSocket {
              constructor() { this.readyState = NativeWebSocket.CONNECTING; this.binaryType = "blob"; }
              send() {}
              close() { this.readyState = NativeWebSocket.CLOSED; }
              addEventListener() {}
              removeEventListener() {}
            }
            class RoutedWebSocket {
              constructor(url, ...rest) {
                if (new URL(String(url), location.href).searchParams.get("signal") === "1") return new HangingSignalSocket();
                return new NativeWebSocket(url, ...rest);
              }
              static CONNECTING = NativeWebSocket.CONNECTING;
              static OPEN = NativeWebSocket.OPEN;
              static CLOSING = NativeWebSocket.CLOSING;
              static CLOSED = NativeWebSocket.CLOSED;
            }
            globalThis.WebSocket = RoutedWebSocket;
          })();
        """)
    diagnostics = [[] for _ in pages]
    for index, page in enumerate(pages):
        page.on("pageerror", lambda error, i=index: diagnostics[i].append(f"pageerror: {error}"))
        page.on("console", lambda message, i=index: diagnostics[i].append(f"console {message.type}: {message.text}"))
    for player, page in enumerate(pages):
        page.goto(
            f"{harness}?room={room}&run={run}&player={player}&players={player_count}",
            wait_until="load",
            timeout=30000,
        )

    for index, page in enumerate(pages):
        try:
            page.wait_for_function(
                "globalThis.__peerHarnessPass === true || globalThis.__peerHarnessFailed === true",
                timeout=15000,
            )
        except Exception as error:
            state = page.evaluate("() => ({href: location.href, pass: globalThis.__peerHarnessPass, failed: globalThis.__peerHarnessFailed, open: globalThis.__peerHarnessOpen, mode: globalThis.__peerHarnessMode, transport: globalThis.__eaglerNetplayTransport})")
            raise AssertionError(f"peer harness timeout page={index} state={state} diagnostics={diagnostics[index]}") from error
        failed = page.evaluate("globalThis.__peerHarnessFailed")
        if failed:
            raise AssertionError(page.evaluate("globalThis.__peerHarnessError"))

    modes = [page.evaluate("globalThis.__peerHarnessMode") for page in pages]
    assert modes == [expected_mode for _ in pages], modes
    candidates = [selected_candidate_summary(page) for page in pages] if expected_mode == "rtc" else [None, None]
    recovery = None
    if exercise_recovery:
        page = pages[0]
        page.evaluate("() => [...globalThis.__th07PeerTransport.peers.values()][0].pc.__forceIceState('disconnected')")
        page.wait_for_timeout(600)
        page.evaluate("() => [...globalThis.__th07PeerTransport.peers.values()][0].pc.__clearForcedIceState()")
        page.wait_for_timeout(2600)
        transient_restarts = page.evaluate("globalThis.__iceRestartCalls")
        assert transient_restarts == 0, transient_restarts

        for item in pages:
            item.evaluate("""() => {
              globalThis.__recoveryOldSignal = globalThis.__th07PeerTransport.signal;
              globalThis.__recoveryOldSignal.close(4000, 'recovery contract');
            }""")
        for item in pages:
            item.wait_for_function("""globalThis.__th07PeerTransport.signal &&
              globalThis.__th07PeerTransport.signal !== globalThis.__recoveryOldSignal &&
              globalThis.__th07PeerTransport.signal.readyState === WebSocket.OPEN""", timeout=5000)

        page.evaluate("() => [...globalThis.__th07PeerTransport.peers.values()][0].pc.__forceIceState('failed')")
        page.wait_for_function("globalThis.__iceRestartCalls === 1", timeout=5000)
        page.wait_for_function("""[...globalThis.__th07PeerTransport.peers.values()].every(peer =>
          peer.pc.connectionState === 'connected' && peer.inputDc?.readyState === 'open' && peer.controlDc?.readyState === 'open')""", timeout=7000)
        recovery = {"transientRestarts": transient_restarts, "failedRestarts": page.evaluate("globalThis.__iceRestartCalls")}
    context.close()
    return modes, candidates, recovery


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: test-th07mp-webrtc.py BASE_URL")
    base = sys.argv[1].rstrip("/")
    room = f"rtc{secrets.token_hex(4)}"
    run = secrets.token_hex(4)
    harness = f"{base}/../th07-eagler/build-web-th07-netplay-rebuild/browser-peer-transport-harness.html"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        modes, candidates, recovery = run_group(browser, harness, room, run, expected_mode="rtc", exercise_recovery=True)
        relay_room = f"rtc{secrets.token_hex(4)}"
        relay_run = secrets.token_hex(4)
        relay_modes, _, _ = run_group(
            browser, harness, relay_room, relay_run,
            disable_webrtc=True, expected_mode="relay",
        )
        mesh_room = f"rtc{secrets.token_hex(4)}"
        mesh_run = secrets.token_hex(4)
        mesh_modes, mesh_candidates, _ = run_group(
            browser, harness, mesh_room, mesh_run,
            player_count=3, expected_mode="rtc",
        )
        skew_room = f"rtc{secrets.token_hex(4)}"
        skew_run = secrets.token_hex(4)
        skew_modes, _, _ = run_group(
            browser, harness, skew_room, skew_run,
            expected_mode="rtc", delay_rtc_route_player=1,
        )
        missing_signal_room = f"rtc{secrets.token_hex(4)}"
        missing_signal_run = secrets.token_hex(4)
        missing_signal_modes, _, _ = run_group(
            browser, harness, missing_signal_room, missing_signal_run,
            expected_mode="relay", hanging_signal_player=1,
        )
        print(
            f"TH07MP WebRTC transport: PASS rtc_room={room} rtc_run={run} "
            f"rtc_modes={modes} candidates={candidates} recovery={recovery} "
            f"fallback_room={relay_room} fallback_run={relay_run} fallback_modes={relay_modes} "
            f"mesh_room={mesh_room} mesh_run={mesh_run} mesh_modes={mesh_modes} mesh_candidates={mesh_candidates} "
            f"route_skew_room={skew_room} route_skew_run={skew_run} route_skew_modes={skew_modes}"
            f" missing_signal_room={missing_signal_room} missing_signal_run={missing_signal_run} "
            f"missing_signal_modes={missing_signal_modes}"
        )
        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
