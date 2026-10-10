import {compactDiagnosticText} from '../../../src/launcher/runtime-diagnostics-model.mts';
import type {RuntimeNetplaySnapshot, RuntimePeerQuality} from './native-snapshot';
export interface NetplayDisplayContext {
 roomCode: string | null; runtimeVariant: 'normal' | 'multiplayer'; player: number | null; playerCount: number;
 inputDelay: number; adonisMode: number; adonisSupported: boolean;
}
export interface NetplayQuality {
 peers: Map<number, RuntimePeerQuality>; confirmed: number | null; confirmedAt: number | null;
}
/** Main app2660–2719, exact diagnostic labels/rounding/quality meaning. */
export function formatNetplayDiagnostics(net: RuntimeNetplaySnapshot, context: NetplayDisplayContext,
 quality: NetplayQuality, now: () => number,
 t: (key: string, params?: Record<string, string | number>) => string): Readonly<Record<string, string>> {
 const lines: Record<string, string> = {};
 const setRuntimeDiagnostic = (key: string, value: unknown) => {lines[key] = compactDiagnosticText(value);};
  const room = String(context.roomCode || "--");
  const playerIndex = Math.max(0, Number(context.player) || 0);
  const playerCount = Math.max(2, Number(context.playerCount) || 2);
  const role = net.spectator ? t("diagnostics.netplayRoleSpectator", { players: playerCount }) : `P${playerIndex + 1}/${playerCount}`;
  setRuntimeDiagnostic('runtimeNetplaySessionDiag', t("diagnostics.netplayRuntime", {
    room, role, runtime: `${context.runtimeVariant}/${net.mode || "--"}`,
  }));
  const timingPending=context.adonisSupported && !!context.adonisMode && net.inputDelay===null && !net.active;
  setRuntimeDiagnostic('runtimeNetplayInputDelayDiag', timingPending?t("room.inputDelayMeasuring"):t("diagnostics.inputDelay", {
    frames: Math.max(0, Math.trunc(net.inputDelay ?? (Number(context.inputDelay) || 0))),
  }));

  const transport = net.transport === "rtc" ? "RTC" : net.transport === "relay" ? "WS Relay" : net.transport === "spectator"
    ? t("diagnostics.transportSpectator") : t("diagnostics.transportConnecting");
  const route = net.transport === "relay" ? "relay" : net.path;
  const expectedPeers = Math.max(1, playerCount - 1);
  const peerStatus = net.spectator ? t("diagnostics.peerSpectator") : net.peerCount == null ? "peers --" : `peers ${net.peerCount}/${expectedPeers}${net.rtcReady ? " ready" : ""}`;
  setRuntimeDiagnostic('runtimeNetplayRouteDiag', t("diagnostics.network", {
    transport, route,
    peers: peerStatus,
    failure: net.failed ? ` - FAIL ${net.error || "transport"}` : "",
  }));

  const frame = net.active && net.frame != null ? Math.max(0, Math.trunc(net.frame)) : null;
  const confirmed = net.confirmed != null && net.confirmed >= 0 && net.confirmed < 0xffffffff
    ? Math.trunc(net.confirmed) : null;
  if (confirmed != null && confirmed !== quality.confirmed) {
    quality.confirmed = confirmed;
    quality.confirmedAt = now();
  }
  const peerFrames = net.lanPeers
    .map(peer => `P${Number(peer.player) + 1} gap ${Math.max(0, Math.trunc(Number(peer.gap) || 0))}/pred ${Math.max(0, Math.trunc(Number(peer.predicted) || 0))}/rb ${Math.max(0, Math.trunc(Number(peer.rollbacks) || 0))}`)
    .join(" - ");
  setRuntimeDiagnostic('runtimeNetplayFrameDiag', net.active
    ? t("diagnostics.sync", { frame: frame ?? "--", confirmed: confirmed ?? "--", peers: peerFrames ? ` - ${peerFrames}` : "" })
    : t("diagnostics.syncWaiting"));

  const rollback = net.rollback != null ? Math.max(0, Math.trunc(net.rollback)) : 0;
  const resimulated = net.resimulated != null ? Math.max(0, Math.trunc(net.resimulated)) : 0;
  const advantage = net.advantage != null ? `${net.advantage >= 0 ? "+" : ""}${net.advantage.toFixed(2)}` : "--";
  const pacing = net.pacing != null ? net.pacing.toFixed(4) : "--";
  setRuntimeDiagnostic('runtimeNetplayRollbackDiag', net.spectator
    ? t("diagnostics.spectatorRollback")
    : t("diagnostics.rollback", { rollback, resimulated, advantage, pacing }));

  const confirmedAgeMs = quality.confirmedAt == null
    ? null : Math.max(0, now() - quality.confirmedAt);
  const qualities = [...quality.peers.values()];
  const rttValues = qualities.map(quality => quality.rttMs).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const variationValues = qualities.map(quality => quality.variationMs).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const iceStates = [...new Set(qualities
    .map(quality => quality.iceState || quality.connectionState)
    .filter(Boolean))];
  setRuntimeDiagnostic('runtimeNetplayQualityDiag', t("diagnostics.quality", {
    rtt: rttValues.length ? `${Math.round(Math.max(...rttValues))}ms` : "--",
    variation: variationValues.length ? `${Math.round(Math.max(...variationValues))}ms` : "--",
    stall: net.active && confirmedAgeMs != null ? `${(confirmedAgeMs / 1000).toFixed(1)}s` : "--",
  }) + ` - ICE ${iceStates.join("/") || "--"}`);
  setRuntimeDiagnostic('runtimeNetplayIceDiag', net.rtcPaths.length
    ? `ICE ${net.rtcPaths.map(entry => `P${Number(entry.peer) + 1} ${entry.path || "?"}/${String(entry.protocol || "?").toLowerCase()}/${entry.family || "?"}`).join(" - ")}`
    : net.transport === "relay" ? t("diagnostics.iceFallback") : t("diagnostics.iceCandidates"));
  return Object.freeze(lines);
}
