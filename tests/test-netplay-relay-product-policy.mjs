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

function nextJson(socket) {
  return new Promise((resolveMessage, reject) => {
    const onMessage = event => {
      cleanup();
      try { resolveMessage(JSON.parse(String(event.data))); }
      catch (error) { reject(error); }
    };
    const onError = () => { cleanup(); reject(new Error("lobby socket failed")); };
    const cleanup = () => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
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
  const first=nextJson(socket);
  socket.send(JSON.stringify(message));
  let response=await first;
  while(!predicate(response))response=await nextJson(socket);
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
      ...(product!=="th09mp"?[{adonisMode:1,inputDelay:3}]:[])]){
      const rejected=await sendAndMatch(p1,{type:"start",...invalid},response=>response.type==="error");
      assert.match(rejected.error,/input timing/);
    }
    const inputDelay=adonisMode?9:3;
    const started=await sendAndMatch(p1,{type:"start",inputDelay,predictionLimit:2,adonisMode},response=>response.type==="start");
    assert.equal(started.room.inputDelay,inputDelay);
    assert.equal(started.room.adonisMode,adonisMode);
    assert.equal(started.room.predictionLimit,8,
      `${product} must not let lobby timing override its runtime rollback policy`);
    const duplicate=await sendAndMatch(p1,{type:"start",inputDelay:1,adonisMode:2},response=>response.type==="state");
    assert.equal(duplicate.room.inputDelay,inputDelay,"live timing is immutable");
    assert.equal(duplicate.room.adonisMode,adonisMode,"repeated start is not a live mode switch");
  } finally { p1.close(1000);p2.close(1000); }
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

const port = await freePort();
const relayEnv = {
  ...process.env,
  EAGLER_NETPLAY_RELAY_HOST: "127.0.0.1",
  EAGLER_NETPLAY_RELAY_PORT: String(port),
  EAGLER_NETPLAY_STUN_URLS: "",
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
  await verifyGenericRoom(port);
  await verifyRelayOnlyBarrier(port);
  await verifyTh08Timing(port);
  await verifyFixedRollbackInputDelay(port,"th09mp");
  await verifyFixedRollbackInputDelay(port,"th09mp",1);
  await verifyFixedRollbackInputDelay(port,"th09mp",2);
  await verifyFixedRollbackInputDelay(port,"th10mp");
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
