/** Shared by the CI browser fixture and deterministic room-wiring checks.
 * Synthetic-only inputs still obey the real Host and package contracts. */
import {createMultiplayerRoom, type MultiplayerRoomOptions, type RoomSocket} from '../../app/services/multiplayer-room.client';
import type {RuntimePlan} from '../../app/services/runtime.client';
import {validateHostManifest} from '../../src/contracts/host-manifest.mts';
import {PRODUCT_GAMES} from '../../src/contracts/product-catalog.mts';
export const preflightLocalId = 'synthetic_host_123';
export const preflightCodeGeneration = 'a'.repeat(64);
const dataTarget = PRODUCT_GAMES.th08.package.dataTarget;
export const preflightHost = validateHostManifest({
  schema: 'eagler-touhou/host-manifest/1', protocol: 'eagler-touhou/1', profile: 'web-release',
  shared: {resourceMode: 'hosted', runtimeManifest: 'runtime-manifest.json', vanillaFont: 'font.ttf', unicodeFont: 'font.otf', netplayRelay: 'wss://synthetic.invalid/netplay'},
  games: {th08: {runtime: `runtime/th08/${preflightCodeGeneration}/th08.html`, multiplayerRuntime: `runtime/th08/multiplayer/${preflightCodeGeneration}/th08.html`,
    gameData: {path: dataTarget.slice(1), bytes: 2, sha256: 'a'.repeat(64), version: `sha256-${'a'.repeat(64)}`, layout: `sha256-${'b'.repeat(64)}`}, music: {midi: {files: []}}}},
});
export const preflightPlan: RuntimePlan = {game: 'th08', runtimeVariant: 'multiplayer', publishedRuntime: true, entry: '/__ui_tests__/multiplayer-preflight-peer.html', configure: {music: 'none', options: {touchEnabled: false}},
  generation: {id: 'synthetic-preflight-package', game: 'th08', descriptor: {schema: 'eagler-touhou/package/1', game: 'th08', revision: 'synthetic', runtimeRequirement: {protocol: 'eagler-touhou/1', target: 'th08', dataFile: 'game-data'},
    files: {'game-data': {source: dataTarget.slice(1), target: dataTarget, bytes: 2, revision: 'synthetic'}}, base: {files: ['game-data']}, components: {}}, files: {'game-data': {objectId: 'synthetic-memory-only', revision: 'synthetic'}}}};
export const makePreflightRoom = (phase = 'lobby', serial = 0) => ({playerCount: 2, difficulty: 1, visibility: 'public', disableCheatMovement: false, phase, startSerial: serial,
  inputDelay: 0, adonisMode: 1, inputDelayAuto: false, predictionReserve: 2, settingsVersion: 1,
  seats: [{clientId: preflightLocalId, name: 'Synthetic host', loadout: 0, ready: phase !== 'lobby'}, {clientId: 'synthetic_guest_456', name: 'Synthetic guest', loadout: 1, ready: phase !== 'lobby'}], spectators: []});
export class PreflightSocket implements RoomSocket {
  readyState = 1;
  listeners = new Map<string, Array<(event: never) => void>>();
  constructor(private readonly sent: Record<string, unknown>[]) {}
  addEventListener(type: string, listener: (event: never) => void) {this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]);}
  send(data: string) {this.sent.push(JSON.parse(data));}
  close() {this.readyState = 3;}
  message(value: unknown) {for (const listener of this.listeners.get('message') ?? []) listener({data: JSON.stringify(value)} as never);}
}
export function createPreflightRoomFixture({baseUrl, timers, hostManifest = preflightHost}: {baseUrl: string; timers?: MultiplayerRoomOptions['timers']; hostManifest?: unknown}) {
  let socket: PreflightSocket | null = null;
  const sent: Record<string, unknown>[] = [];
  const room = createMultiplayerRoom({baseUrl, timers, fetchImpl: async () => new Response(JSON.stringify(hostManifest)),
    createSocket: () => {const next = new PreflightSocket(sent); socket = next; queueMicrotask(() => next.message({type: 'state', room: makePreflightRoom()})); return next;},
    getMemberId: () => 'synthetic_member_123', identity: {loadDisplayName: () => 'Synthetic host', displayNameLocked: () => true, lobbyClientId: () => preflightLocalId, storeDisplayNameOnce: () => ({stored: false, name: 'Synthetic host'})},
    sessions: {load: () => null, save() {}, clear() {}}, preferences: {load: () => ({shareSingleplayerSettings: true, preferredLoadout: 0}), persistPreferredLoadout() {}, persistShareSingleplayerSettings() {}},
    createNetwork: () => ({update() {}, reset() {}, receive: async () => {}, retry() {}, suspend() {}, minimumRtt: () => null,
      capabilities: () => ({supported: false, rtcAvailable: false, turnConfigured: false}), metric: () => ({rtt: null, jitter: null, state: 'unavailable', at: 0})}) as ReturnType<NonNullable<MultiplayerRoomOptions['createNetwork']>>,
  });
  return {room, sent, getSocket: () => socket};
}
