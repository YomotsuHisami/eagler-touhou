import {multiplayerConfigForProduct, isMultiplayerProductId, type ProductId} from '../../../src/contracts/product-catalog.mts';
// Read-only extraction of main app2313–2391/2437–2509.
type UnknownRecord = Record<string, unknown>;
const record = (value: unknown): UnknownRecord | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
export interface RuntimeNetplayContext {
  product: ProductId;
  runtimeVariant: 'normal' | 'multiplayer';
  netplay: {spectator: boolean};
}
interface RuntimePeer {
  pc?: RTCPeerConnection | null;
  inputOpen?: boolean;
  controlOpen?: boolean;
}

interface RuntimePeerCollection extends Iterable<[number, RuntimePeer]> {
  size: number;
  get(player: number): RuntimePeer | undefined;
}

export interface RuntimePeerTransport {
  disconnected?: boolean;
  isRecovering?(): boolean;
  peers: RuntimePeerCollection;
  relay?: { readyState?: unknown } | null;
  rtcReadySent?: boolean;
  failed?: boolean;
  error?: string;
}

interface RuntimeNetplayEntry extends UnknownRecord {
  player?: unknown;
  gap?: unknown;
  predicted?: unknown;
  rollbacks?: unknown;
  peer?: unknown;
  path?: unknown;
  protocol?: unknown;
  family?: unknown;
}

export interface RuntimeNetplaySnapshot {
  mode: string;
  active: boolean;
  spectator: boolean;
  inputDelay: number | null;
  transport: string;
  path: string;
  frame: number | null;
  confirmed: number | null;
  rollback: number | null;
  resimulated: number | null;
  advantage: number | null;
  pacing: number | null;
  rtcPaths: RuntimeNetplayEntry[];
  lanPeers: RuntimeNetplayEntry[];
  peerCount: number | null;
  rtcReady: boolean;
  failed: boolean;
  error: string;
  peerState: RuntimePeerTransport | null;
}

export interface RuntimePeerQuality {
  samples: number[];
  rttMs: number | null;
  variationMs: number | null;
  connectionState: string;
  iceState: string;
}

function runtimeGlobal(runtime: object | null, name: string): unknown {
  if (!runtime) return undefined;
  try { return (runtime as unknown as UnknownRecord)[name]; }
  catch { return undefined; }
}

function runtimePeerTransport(value: unknown): RuntimePeerTransport | null {
  const source = record(value);
  const peers = record(source?.peers);
  const iterable = peers as object as { [Symbol.iterator]?: unknown };
  if (!source || !peers || typeof peers.get !== "function" || typeof iterable[Symbol.iterator] !== "function") return null;
  return source as unknown as RuntimePeerTransport;
}

function runtimeNetplayEntries(value: unknown, limit: number): RuntimeNetplayEntry[] {
  return Array.isArray(value)
    ? value.flatMap(entry => {
        const item = record(entry);
        return item ? [item as RuntimeNetplayEntry] : [];
      }).slice(0, limit)
    : [];
}

export function readRuntimeNetplay(runtime: object | null, state: RuntimeNetplayContext): RuntimeNetplaySnapshot | null {
  // Product selection alone is not proof that the running game is the LAN
  // Runtime. Never show multiplayer diagnostics over an ordinary game, but
  // keep probing a dedicated multiplayer product even if runtimeVariant was
  // accidentally downgraded - that mismatch is itself diagnostic evidence.
  const multiplayerSurface = state.runtimeVariant === "multiplayer" || isMultiplayerProductId(state.product);
  const multiplayer = multiplayerConfigForProduct(state.product);
  if (!multiplayer || !multiplayerSurface) return null;
  const value = (name: string) => runtimeGlobal(runtime, name);
  const number = (name: string) => {
    const parsed = Number(value(name));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const rawRtcPaths = value("__eaglerNetplayRtcPaths");
  const rtcPaths = runtimeNetplayEntries(rawRtcPaths, 2);
  const rawLanPeers = value("__eaglerNetplayLanPeers");
  const lanPeers = runtimeNetplayEntries(rawLanPeers, 3);
  const peerState = runtimePeerTransport(value(multiplayer.peerTransportGlobal));
  let mode = "";
  try { mode = String((runtime as {Module?: {eaglerOptions?: {netplayMode?: unknown}}} | null)?.Module?.eaglerOptions?.netplayMode || ""); } catch {}
  if (mode !== "lan") return null;
  const peerSize = Number(peerState?.peers?.size);
  return {
    mode,
    active: value("__eaglerNetplayLanActive") === true,
    spectator: value("__eaglerNetplaySpectator") === true || state.netplay.spectator === true,
    inputDelay: number("__eaglerNetplayInputDelayFrames"),
    transport: String(value("__eaglerNetplayTransport") || "connecting"),
    path: String(value("__eaglerNetplayPath") || "connecting"),
    frame: number("__eaglerNetplayLanFrame"),
    confirmed: number("__eaglerNetplayLanConfirmed"),
    rollback: number("__eaglerNetplayLanRollback"),
    resimulated: number("__eaglerNetplayLanResimulated"),
    advantage: number("__eaglerNetplayLanFrameAdvantage"),
    pacing: number("__eaglerNetplayLanPacingScale"),
    rtcPaths,
    lanPeers,
    peerCount: Number.isFinite(peerSize) && peerSize >= 0 ? peerSize : null,
    rtcReady: peerState?.rtcReadySent === true,
    failed: peerState?.failed === true,
    error: typeof peerState?.error === "string" ? peerState.error : "",
    peerState,
  };
}
