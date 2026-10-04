import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PRODUCT_GAMES } from "../lib/contracts/product-catalog.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const relayPath = resolve(root, "server/netplay-relay.mjs");
const multiplayerGames = Object.entries(PRODUCT_GAMES)
  .filter(([, product]) => !!product.multiplayer)
  .map(([game]) => game);

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(error => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

function waitListening(child) {
  return new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error("relay start timeout")), 5000);
    const onData = chunk => {
      if (!String(chunk).includes("listening")) return;
      clearTimeout(timer);
      child.stdout.off("data", onData);
      resolveReady();
    };
    child.stdout.on("data", onData);
    child.once("exit", code => {
      clearTimeout(timer);
      reject(new Error(`relay exited before listen: ${code}`));
    });
  });
}

function nextJson(socket, predicate = () => true, context = "lobby response") {
  return new Promise((resolveMessage, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`${context} timeout`)); }, 5000);
    const onMessage = event => {
      try {
        const message = JSON.parse(String(event.data));
        if (!predicate(message)) return;
        cleanup(); resolveMessage(message);
      } catch (error) { cleanup(); reject(error); }
    };
    const onError = () => { cleanup(); reject(new Error("lobby socket failed")); };
    const onClose = () => { cleanup(); reject(new Error(`${context}: lobby socket closed`)); };
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

async function openLobby(port, room, clientId) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?room=${room}&lobby=${clientId}`);
  const first = nextJson(socket);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", () => reject(new Error("lobby open failed")), { once: true });
  });
  const initial = await first;
  assert.equal(initial.type, "state");
  return socket;
}

async function sendAndReceive(socket, message) {
  const response = nextJson(socket);
  socket.send(JSON.stringify(message));
  return response;
}
async function sendAndMatch(socket,message,predicate) {
  // Keep one listener until the match: several frames may arrive in one pump.
  const response=nextJson(socket,predicate,`room=${new URL(socket.url).searchParams.get("room")} ${message.type}`);
  socket.send(JSON.stringify(message));
  return response;
}

async function verifyProduct(port, game) {
  const multiplayer = PRODUCT_GAMES[game].multiplayer;
  assert.ok(multiplayer, `${game} must declare multiplayer policy`);
  const product = `${game}mp`;
  const room = `${product}-policy${Date.now().toString(36)}`;
  const socket = await openLobby(port, room, `${product}_client`);
  try {
    const invalid = await sendAndReceive(socket, {
      type: "take-seat", seat: 0, loadout: multiplayer.loadouts.length, ready: false,
    });
    assert.equal(invalid.type, "error");
    assert.match(invalid.error, /loadout/);

    const seated = await sendAndReceive(socket, {
      type: "take-seat", seat: 0, loadout: multiplayer.loadouts.length - 1, ready: false,
    });
    assert.equal(seated.type, "state");
    assert.equal(seated.room.seats[0].loadout, multiplayer.loadouts.length - 1);

    const settings = await sendAndReceive(socket, {
      type: "settings", playerCount: multiplayer.playerCounts[0], difficulty: multiplayer.difficulties.length,
    });
    assert.equal(settings.type, "state");
    assert.equal(settings.room.difficulty, multiplayer.difficulties.length - 1);
  } finally {
    socket.close(1000);
  }
}

async function verifyGenericRoom(port) {
  const socket = await openLobby(port, `genericpolicy${Date.now().toString(36)}`, "generic_client");
  try {
    const seated = await sendAndReceive(socket, {
      type: "take-seat", seat: 0, loadout: 5, ready: false,
    });
    assert.equal(seated.type, "state");
    assert.equal(seated.room.seats[0].loadout, 5);
    const settings = await sendAndReceive(socket, { type: "settings", playerCount: 2, difficulty: 5 });
    assert.equal(settings.type, "state");
    assert.equal(settings.room.difficulty, 5);
  } finally {
    socket.close(1000);
  }
}

async function verifyModes(port, product) {
  const room = `${product}-modes${Date.now().toString(36)}`;
  const host = await openLobby(port, room, 'modes_host'), guest = await openLobby(port, room, 'modes_guest');
  try {
    await sendAndMatch(host, {type:'take-seat',seat:0,loadout:0}, r => r.room?.seats[0]);
    await sendAndMatch(guest, {type:'take-seat',seat:1,loadout:1}, r => r.room?.seats[1]);
    await sendAndMatch(host, {type:'set-ready',ready:true}, r => r.room?.seats[0]?.ready);
    await sendAndMatch(guest, {type:'set-ready',ready:true}, r => r.room?.seats[1]?.ready);
    await sendAndMatch(guest, {type:'settings',challengeMode:true,prankMode:true}, r => r.type==='error');
    const changed = await sendAndMatch(host, {type:'settings',playerCount:2,difficulty:1,challengeMode:true,prankMode:true}, r =>
      r.room?.challengeMode === (product !== 'th09mp'));
    assert.equal(changed.room.prankMode, product !== 'th09mp');
    if (product !== 'th09mp') {
      assert.equal(changed.room.seats.every(seat => !seat?.ready), true);
      await sendAndMatch(host, {type:'set-ready',ready:true}, r => r.room?.seats[0]?.ready);
      await sendAndMatch(guest, {type:'set-ready',ready:true}, r => r.room?.seats[1]?.ready);
    }
    const started = await sendAndMatch(host, {type:'start'}, r => r.type==='start');
    assert.equal(started.room.challengeMode, product !== 'th09mp');
    await sendAndMatch(host, {type:'settings',challengeMode:false,prankMode:false}, r => r.type==='error');
    const locked = await sendAndMatch(host, {type:'start'}, r => r.type==='state');
    assert.equal(locked.room.challengeMode, started.room.challengeMode);
    assert.equal(locked.room.prankMode, started.room.prankMode);
  } finally { host.close(1000); guest.close(1000); }
}

async function verifyTh08Timing(port) {
  const room=`th08mp-timing${Date.now().toString(36)}`;
  const p1=await openLobby(port,room,"th08_timing_p1");
  const p2=await openLobby(port,room,"th08_timing_p2");
  try {
    await sendAndMatch(p1,{type:"take-seat",seat:0,loadout:0,ready:false,movementMode:"touch",touchEnabled:true,mobileDevice:true},
      response=>response.room?.seats?.[0]?.clientId==="th08_timing_p1");
    const joined=await sendAndMatch(p2,{type:"take-seat",seat:1,loadout:1,ready:false,movementMode:"touch",touchEnabled:true,mobileDevice:true},
      response=>response.room?.seats?.[1]?.clientId==="th08_timing_p2");
    assert.equal(joined.room.seats[0].mobileDevice,true);
    assert.equal(joined.room.seats[1].mobileDevice,true);
    await sendAndMatch(p1,{type:"set-ready",ready:true,movementMode:"touch",touchEnabled:true,mobileDevice:true},
      response=>response.room?.seats?.[0]?.ready===true);
    await sendAndMatch(p2,{type:"set-ready",ready:true,movementMode:"touch",touchEnabled:true,mobileDevice:true},
      response=>response.room?.seats?.[1]?.ready===true);
    const started=await sendAndMatch(p1,{type:"start",inputDelay:4,predictionLimit:2},response=>response.type==="start");
    assert.equal(started.type,"start");
    assert.equal(started.room.inputDelay,4);
    assert.equal(started.room.predictionLimit,2);
  } finally { p1.close(1000);p2.close(1000); }
}

async function verifyFixedRollbackInputDelay(port, product, adonisMode=0) {
  const room=`${product}-timing${Date.now().toString(36)}`;
  const p1=await openLobby(port,room,`${product}_timing_p1`);
  const p2=await openLobby(port,room,`${product}_timing_p2`);
  try {
    await sendAndMatch(p1,{type:"take-seat",seat:0,loadout:0,ready:false,movementMode:"normal",touchEnabled:false,mobileDevice:false},
      response=>response.room?.seats?.[0]?.clientId===`${product}_timing_p1`);
    await sendAndMatch(p2,{type:"take-seat",seat:1,loadout:1,ready:false,movementMode:"normal",touchEnabled:false,mobileDevice:false},
      response=>response.room?.seats?.[1]?.clientId===`${product}_timing_p2`);
    await sendAndMatch(p1,{type:"set-ready",ready:true,movementMode:"normal",touchEnabled:false,mobileDevice:false},
      response=>response.room?.seats?.[0]?.ready===true);
    await sendAndMatch(p2,{type:"set-ready",ready:true,movementMode:"normal",touchEnabled:false,mobileDevice:false},
      response=>response.room?.seats?.[1]?.ready===true);
    const unauthorized=await sendAndMatch(p2,{type:"start",adonisMode:1,inputDelay:4},response=>response.type==="error");
    assert.match(unauthorized.error,/P1/);
    for(const invalid of [{adonisMode:3,inputDelay:3},{adonisMode:1,inputDelay:10},
      ...(!["th08mp","th09mp","th10mp"].includes(product)?[{adonisMode:1,inputDelay:3}]:[])]){
      const rejected=await sendAndMatch(p1,{type:"start",...invalid},response=>response.type==="error");
      assert.match(rejected.error,/input timing/);
    }
    const inputDelay=adonisMode?9:3;
    const started=await sendAndMatch(p1,{type:"start",inputDelay,predictionLimit:2,adonisMode},response=>response.type==="start");
    assert.equal(started.room.inputDelay,inputDelay);
    assert.equal(started.room.adonisMode,adonisMode);
    assert.equal(started.room.predictionLimit,product==="th08mp"?2:8,
      `${product} must not let lobby timing override its runtime rollback policy`);
    const duplicate=await sendAndMatch(p1,{type:"start",inputDelay:1,adonisMode:2},response=>response.type==="state");
    assert.equal(duplicate.room.inputDelay,inputDelay,"live timing is immutable");
    assert.equal(duplicate.room.adonisMode,adonisMode,"repeated start is not a live mode switch");
  } finally { p1.close(1000);p2.close(1000); }
}

async function verifyMeasuredTiming(port,mode,reserve,automatic,rttP95Us=90000,product='th09mp') {
  const room=`${product}-measured${mode}${reserve}${+automatic}${Date.now().toString(36)}`;
  const p1=await openLobby(port,room,'measured_host'),p2=await openLobby(port,room,'measured_guest');
  try{
    await sendAndMatch(p1,{type:'take-seat',seat:0,loadout:0},r=>r.room?.seats[0]);
    await sendAndMatch(p2,{type:'take-seat',seat:1,loadout:1},r=>r.room?.seats[1]);
    await sendAndMatch(p1,{type:'set-ready',ready:true},r=>r.room?.seats[0]?.ready);
    await sendAndMatch(p2,{type:'set-ready',ready:true},r=>r.room?.seats[1]?.ready);
    for(const bad of [{inputDelayAuto:'true'},{predictionReserve:0},{predictionReserve:3}])
      await sendAndMatch(p1,{type:'start',adonisMode:mode,inputDelay:0,inputDelayAuto:automatic,predictionReserve:reserve,...bad},r=>r.type==='error');
    const start=await sendAndMatch(p1,{type:'start',adonisMode:mode,inputDelay:automatic?0:9,inputDelayAuto:automatic,predictionReserve:reserve},r=>r.type==='start');
    assert.equal(start.room.inputDelayAuto,automatic);assert.equal(start.room.predictionReserve,reserve);assert.equal(start.room.timing,null);
    const fullDelay=Math.max(1,Math.ceil(Math.floor(rttP95Us/2)*60/1000000));
    const prediction=mode===2?Math.min(reserve,fullDelay-(automatic?1:0)):0;
    const timing={phase:'ready',automatic,adonisMode:mode,inputDelay:automatic?fullDelay-prediction:9,
      fullDelay,predictionReserve:prediction,rttP95Us,samples:119,lost:2,route:'rtc'};
    await sendAndMatch(p2,{type:'timing-result',serial:start.serial,timing},r=>r.type==='error');
    await sendAndMatch(p1,{type:'timing-result',serial:start.serial+1,timing},r=>r.type==='error');
    if(mode===2&&automatic&&fullDelay<=2)
      await sendAndMatch(p1,{type:'timing-result',serial:start.serial,timing:{...timing,inputDelay:0,predictionReserve:fullDelay}},r=>r.type==='error');
    const result=await sendAndMatch(p1,{type:'timing-result',serial:start.serial,timing},r=>r.room?.timing);
    assert.deepEqual(result.room.timing,timing);assert.equal(result.room.inputDelay,timing.inputDelay);
    const repeat=await sendAndMatch(p1,{type:'timing-result',serial:start.serial,timing},r=>r.room?.timing);
    assert.deepEqual(repeat.room.timing,timing);
    await sendAndMatch(p1,{type:'timing-result',serial:start.serial,timing:{...timing,rttP95Us:rttP95Us+1000}},r=>r.type==='error');
    const immutable=await sendAndMatch(p1,{type:'start',adonisMode:mode,inputDelayAuto:!automatic,inputDelay:0},r=>r.type==='state');
    assert.deepEqual(immutable.room.timing,timing);
  }finally{p1.close(1000);p2.close(1000);}
}

async function verifyRelayOnlyBarrier(port) {
  const sockets = [];
  const room = `fallback${Date.now().toString(36)}`;
  function peer(player, players) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/?room=${room}&run=1&player=${player}&players=${players}`);
    sockets.push(socket);
    return socket;
  }
  function route(socket) {
    return new Promise((resolveRoute, reject) => {
      const timer = setTimeout(() => reject(new Error('relay-only route timeout')), 5000);
      socket.addEventListener('message', event => {
        const message = JSON.parse(String(event.data));
        if (message.type === 'route') { clearTimeout(timer); resolveRoute(message.mode); }
      });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('relay-only socket failed')); }, { once: true });
    });
  }
  try {
    const first = peer(0, 2), firstRoute = route(first);
    const second = peer(1, 2), secondRoute = route(second);
    assert.deepEqual(await Promise.all([firstRoute, secondRoute]), ['relay', 'relay']);
    const invalid = peer(2, 3);
    const closed = await new Promise((resolveClose, reject) => {
      const timer = setTimeout(() => reject(new Error('mixed player count was admitted')), 5000);
      invalid.addEventListener('close', event => { clearTimeout(timer); resolveClose(event); }, { once: true });
    });
    assert.equal(closed.code, 1008);
    assert.match(closed.reason, /player count mismatch/);
    assert.equal(first.readyState, WebSocket.OPEN);
    assert.equal(second.readyState, WebSocket.OPEN);
  } finally { for (const socket of sockets) socket.close(); }
}

// Unrelated and matching frames can be dispatched before an await resumes.
const burstSocket = new EventTarget();
const burstResponse = nextJson(burstSocket, message => message.ready === true);
for (const ready of [false, true]) {
  const event = new Event("message");
  event.data = JSON.stringify({ type: "state", ready });
  burstSocket.dispatchEvent(event);
}
assert.equal((await burstResponse).ready, true);
const closedSocket = new EventTarget();
const closedResponse = nextJson(closedSocket);
closedSocket.dispatchEvent(new Event("close"));
await assert.rejects(closedResponse, /socket closed/);

const port = await freePort();
const relayEnv = {
  ...process.env,
  EAGLER_NETPLAY_RELAY_HOST: "127.0.0.1",
  EAGLER_NETPLAY_RELAY_PORT: String(port),
  EAGLER_NETPLAY_STUN_URLS: "",
  // This suite intentionally creates many distinct product rooms on one IP.
  EAGLER_NETPLAY_MAX_ROOMS_PER_IP: "100",
  EAGLER_NETPLAY_CONNECTIONS_PER_MINUTE: "300",
};
for (const legacy of ["TH07_RELAY_HOST", "TH07_RELAY_PORT", "TH07_STUN_URLS"])
  delete relayEnv[legacy];
const relay = spawn(process.execPath, [relayPath], {
  cwd: root,
  env: relayEnv,
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitListening(relay);
  for (const game of multiplayerGames) await verifyProduct(port, game);
  for (const game of multiplayerGames) await verifyModes(port, `${game}mp`);
  await verifyGenericRoom(port);
  await verifyRelayOnlyBarrier(port);
  await verifyTh08Timing(port);
  await verifyFixedRollbackInputDelay(port,"th08mp",1);
  await verifyFixedRollbackInputDelay(port,"th08mp",2);
  await verifyFixedRollbackInputDelay(port,"th09mp");
  await verifyFixedRollbackInputDelay(port,"th09mp",1);
  await verifyFixedRollbackInputDelay(port,"th09mp",2);
  await verifyFixedRollbackInputDelay(port,"th10mp");
  await verifyFixedRollbackInputDelay(port,"th10mp",1);
  await verifyFixedRollbackInputDelay(port,"th10mp",2);
  for(const mode of [1,2])for(const reserve of [1,2])for(const auto of [false,true])await verifyMeasuredTiming(port,mode,reserve,auto);
  for(const rtt of [32000,60000,120000])await verifyMeasuredTiming(port,2,2,true,rtt);
  for(const product of ['th08mp','th10mp'])for(const mode of [1,2])for(const auto of [false,true])
    await verifyMeasuredTiming(port,mode,2,auto,90000,product);
} finally {
  relay.kill();
}

console.log(JSON.stringify({
  netplayRelayProductPolicy: "PASS",
  products: multiplayerGames.map(game => `${game}mp`),
  policyOwner: "product-catalog",
  genericRooms: "product-neutral",
  configuration: "EAGLER_NETPLAY_*",
}));
