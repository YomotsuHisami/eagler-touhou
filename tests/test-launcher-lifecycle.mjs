import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  confirmRuntimeClose,
  createGameDataContinuation,
  gameDataContinuationMatches,
  shouldDeferAppShellReload,
} from "../.cache/build/browser/assets/launcher/launcher-lifecycle.mjs";

const idle={launched:false,runtimeReady:false,runtimeSessionActive:false,touchLayoutEditing:false,blockingOperation:false,gameDataAttempt:false,launchInFlight:false,decisionOpen:false,replayOpen:false};
assert.equal(shouldDeferAppShellReload(idle),false);
for (const key of Object.keys(idle)) assert.equal(shouldDeferAppShellReload({...idle,[key]:true}),true,key);

let attempts=0;
const decisions=["retry","stay"];
assert.equal(await confirmRuntimeClose({runtimeReady:()=>true,sync:async()=>{attempts++;throw Error("x")},decide:async()=>decisions.shift()}),false);
assert.equal(attempts,2);
assert.equal(await confirmRuntimeClose({runtimeReady:()=>true,sync:async()=>{},decide:async()=>"stay"}),true);
assert.equal(await confirmRuntimeClose({runtimeReady:()=>true,sync:async()=>{throw Error("x")},decide:async()=>"leave"}),true);
let stillReady=true, decisionsAfterExit=0;
assert.equal(await confirmRuntimeClose({runtimeReady:()=>stillReady,sync:async()=>{stillReady=false;throw Error("runtime exited")},decide:async()=>{decisionsAfterExit++;return "stay"}}),true);
assert.equal(decisionsAfterExit,0);

const launch=createGameDataContinuation({kind:"launch",product:"th06mp",roomCode:"ABC123",replayViewer:false});
assert.equal(gameDataContinuationMatches(launch,{product:"th06mp",roomCode:"ABC123",replayViewer:false}),true);
assert.equal(gameDataContinuationMatches(launch,{product:"th06mp",roomCode:"OTHER",replayViewer:false}),false);
assert.equal(gameDataContinuationMatches(createGameDataContinuation({kind:"install-only",product:"th06"}),{product:"th06"}),false);
console.log("Launcher lifecycle: PASS");

const appSource = await readFile("src/launcher/app.mts", "utf8");
assert.match(appSource, /async function exitPlayerFullscreen\(\)[\s\S]*document\.exitFullscreen[\s\S]*webkitExitFullscreen/);
assert.match(appSource, /if \(isPlayerFullscreen\(\)\) await exitPlayerFullscreen\(\)\.catch/);
assert.doesNotMatch(appSource, /touchLayoutEditorEnteredFullscreen[\s\S]{0,180}document\.exitFullscreen/,
  "touch-layout editor cleanup must share the WebKit-compatible fullscreen exit path");
