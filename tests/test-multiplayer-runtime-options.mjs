import assert from "node:assert/strict";
import { buildMultiplayerRuntimeOptions } from "../.cache/build/browser/assets/launcher/multiplayer-runtime-options.mjs";
import { PRODUCT_GAMES } from "../lib/contracts/product-catalog.mjs";

const th06 = {
  playerCounts: PRODUCT_GAMES.th06.multiplayer.playerCounts,
  difficulties: PRODUCT_GAMES.th06.multiplayer.difficulties,
  loadouts: PRODUCT_GAMES.th06.multiplayer.loadouts,
};
const th07 = {
  playerCounts: PRODUCT_GAMES.th07.multiplayer.playerCounts,
  difficulties: PRODUCT_GAMES.th07.multiplayer.difficulties,
  loadouts: PRODUCT_GAMES.th07.multiplayer.loadouts,
};
const base = {
  url: "wss://relay.example.test/netplay?room=th06mp-1234&run=1&player=0",
  player: 0,
  playerCount: 2,
  seed: 1234,
  difficulty: 4,
  spectator: false,
  spectatorId: "",
  spectatorCount: 2,
  iceServers: [{ urls: "stun:example.test" }],
  loadouts: [
    { character: 0, shot: 0 },
    { character: 1, shot: 1 },
    { character: 2, shot: 0 },
  ],
};

assert.deepEqual(buildMultiplayerRuntimeOptions(base, th06), {
  netplayMode: "lan",
  netplayUrl: base.url,
  netplayPlayer: 0,
  netplayPlayerCount: 2,
  netplaySeed: 1234,
  netplayDifficulty: 4,
  netplaySpectator: false,
  netplaySpectatorId: "",
  netplaySpectatorCount: 2,
  netplayIceServers: base.iceServers,
  netplayLoadouts: base.loadouts.slice(0, 2),
}, "Runtime options must use only the active player-count prefix of loadouts");
const th08Timing=buildMultiplayerRuntimeOptions({ ...base, inputDelay: 4, predictionLimit: 2 }, th06);
assert.equal(th08Timing.netplayInputDelay, 4);
assert.equal(th08Timing.netplayPredictionLimit, 2);
const inputDelayOnly=buildMultiplayerRuntimeOptions({ ...base, inputDelay: 3 }, th06);
assert.equal(inputDelayOnly.netplayInputDelay, 3);
assert.equal("netplayPredictionLimit" in inputDelayOnly, false,
  "TH09/TH10 input delay must not silently override each title's rollback limit");

const adonisBase={...base,url:base.url.replace('th06mp-','th09mp-'),inputDelay:9,adonisMode:1};
for(const product of ['th08mp','th09mp','th10mp'])for(const adonisMode of [1,2]){
  const options=buildMultiplayerRuntimeOptions({...adonisBase,url:adonisBase.url.replace('th09mp',product),adonisMode},th06);
  assert.equal(options.netplayAdonisMode,adonisMode);
  assert.equal(options.netplayInputDelay,9);
}
for(const product of ['th08mp','th10mp']) {
  const stable={...base,url:base.url.replace('th06mp',product),inputDelay:3};
  const options=buildMultiplayerRuntimeOptions(stable,th06);
  assert.equal(options.netplayInputDelay,3);
  assert.equal('netplayAdonisMode' in options,false);
  assert.equal('netplayInputDelayAuto' in options,false);
  assert.equal('netplayPredictionReserve' in options,false);
  assert.equal(buildMultiplayerRuntimeOptions({...stable,adonisMode:1},th06).netplayAdonisMode,1);
}
for(const adonisMode of [-1,3,1.5,NaN])assert.throws(()=>buildMultiplayerRuntimeOptions({...adonisBase,adonisMode},th06),/Adonis/);
for(const inputDelay of [-1,10,1.5,NaN])assert.throws(()=>buildMultiplayerRuntimeOptions({...adonisBase,inputDelay},th06),/Adonis/);
assert.throws(()=>buildMultiplayerRuntimeOptions({...base,adonisMode:1,inputDelay:3},th06),/不支持 Adonis/);

const spectator = buildMultiplayerRuntimeOptions({
  ...base,
  url: "ws://relay.example.test/?room=th07mp-4321&run=2&spectator=c12345678",
  player: 0,
  playerCount: 3,
  difficulty: 5,
  spectator: true,
  spectatorId: "c12345678",
  loadouts: [
    { character: 0, shot: 0 },
    { character: 1, shot: 0 },
    { character: 2, shot: 1 },
  ],
}, th07);
assert.equal(spectator.netplaySpectator, true);
assert.equal(spectator.netplaySpectatorId, "c12345678");
assert.equal(spectator.netplayPlayerCount, 3);

assert.throws(() => buildMultiplayerRuntimeOptions({ ...base, url: "https://relay.example.test/" }, th06), /必须使用 ws:\/\/ 或 wss:\/\//);
assert.throws(() => buildMultiplayerRuntimeOptions({ ...base, url: "not-a-url" }, th06), /WebSocket URL 无效/);
assert.throws(() => buildMultiplayerRuntimeOptions({ ...base, player: 2 }, th06), /玩家槽位无效/);
assert.throws(() => buildMultiplayerRuntimeOptions({ ...base, playerCount: 4 }, th06), /玩家槽位无效/);
assert.throws(() => buildMultiplayerRuntimeOptions({ ...base, seed: 65536 }, th06), /同步种子/);
assert.throws(() => buildMultiplayerRuntimeOptions({ ...base, difficulty: 5 }, th06), /0–4/,
  "TH06 constraints must reject TH07-only Phantasm difficulty");
assert.throws(() => buildMultiplayerRuntimeOptions({
  ...base,
  loadouts: [{ character: 2, shot: 0 }, { character: 1, shot: 0 }],
}, th06), /P1 机体配置无效/, "TH06 constraints must reject TH07-only Sakuya loadouts");
const nonAB = buildMultiplayerRuntimeOptions({
  ...base,
  loadouts: [{ character: 0, shot: 2 }, { character: 0, shot: 2 }],
}, { playerCounts: [2, 3], difficulties: ["0", "1", "2", "3", "4"], loadouts: [{ character: 0, shot: 2 }] });
assert.deepEqual(nonAB.netplayLoadouts, [{ character: 0, shot: 2 }, { character: 0, shot: 2 }],
  "Runtime protocol must validate product-declared loadout pairs instead of assuming A/B shot ids");
assert.throws(() => buildMultiplayerRuntimeOptions({ ...base, loadouts: [{ character: 0, shot: 0 }] }, th06), /配置数量不足/);
assert.throws(() => buildMultiplayerRuntimeOptions({
  ...base, spectator: true, spectatorId: "short",
}, th06), /旁观者资格无效/);

console.log(JSON.stringify({
  multiplayerRuntimeOptions: "PASS",
  playerCounts: [2, 3],
  productConstraints: ["playerCounts", "difficulties", "loadouts"],
  spectator: "explicit-role",
}));
