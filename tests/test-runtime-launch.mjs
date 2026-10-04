import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareRuntimeLaunch } from "../.cache/build/browser/assets/launcher/runtime-launch.mjs";
import { canonicalRuntimePayload, RUNTIME_MANIFEST_SCHEMA, RUNTIME_PROTOCOL,
  RUNTIME_CACHE_PROTOCOL, RUNTIME_CAPABILITIES, RUNTIME_PREPARE } from "../lib/contracts/runtime-generations.mjs";
const hash = text => createHash("sha256").update(text).digest("hex");
function generation(version) {
  const bodies={"game.html":`<script src="game.js"></script>${version}`,"game.js":`// ${version}`,"game.wasm":`wasm ${version}`};
  const files=Object.entries(bodies).map(([path,body])=>({path,bytes:Buffer.byteLength(body),sha256:hash(body)}));
  return {descriptor:{generation:hash(canonicalRuntimePayload("game.html",files)),entry:"game.html",files},bodies};
}
const A=generation("a"),B=generation("b"),root="runtime/th08/",baseUrl="https://example.test/mount/";
const manifest={schema:RUNTIME_MANIFEST_SCHEMA,protocol:RUNTIME_PROTOCOL,groups:[{root,current:B.descriptor,previous:[A.descriptor]}]};
const requests=[];
let bad=false,offline=false;
const fetchImpl=async(input,options)=>{
  const url=new URL(input);
  requests.push({url:url.href,...options});
  if(offline)throw new Error("offline");
  if(url.pathname.endsWith("runtime-manifest.json"))return new Response(JSON.stringify(manifest));
  const generation=url.pathname.includes(B.descriptor.generation)?B:A;
  const name=url.pathname.split("/").at(-1),body=bad && generation===B && name==="game.wasm"?"incorrect":generation.bodies[name];
  return new Response(body??"missing",{status:body?200:404});
};
let resolveWorker;
const delayedWorker=new Promise(resolve=>resolveWorker=resolve);
const pending=prepareRuntimeLaunch(root+"game.html?hosted=1&gameGeneration=package-id",{baseUrl,fetchImpl,worker:delayedWorker});
assert.equal(requests[0].url,baseUrl+"runtime-manifest.json","check newest immediately, before worker readiness");
resolveWorker(null);
const first=await pending;
assert.equal(first.generation,B.descriptor.generation);assert.equal(first.cached,false);
assert.equal(new URL(first.url).searchParams.get("gameGeneration"),"package-id","code generation must not replace game DATA identity");
assert.ok(requests.every(request=>request.cache==="no-store" && request.redirect==="error"));
assert.ok(requests.slice(1).every(request=>request.url.startsWith(baseUrl+root+B.descriptor.generation+"/")));
bad=true;
const rollback=await prepareRuntimeLaunch(root+"game.html",{baseUrl,fetchImpl,worker:null});
assert.equal(rollback.generation,A.descriptor.generation,"without SW, verify earlier whole server generation before opening it");
bad=false;
const excluded=await prepareRuntimeLaunch(root+"game.html",{baseUrl,fetchImpl,worker:null,exclude:[B.descriptor.generation]});
assert.equal(excluded.generation,A.descriptor.generation);
const messages=[];
const worker={postMessage(data,ports){messages.push(data);ports[0].postMessage(data.type===RUNTIME_CAPABILITIES
  ?{ok:true,protocol:RUNTIME_CACHE_PROTOCOL}
  :{ok:true,protocol:RUNTIME_CACHE_PROTOCOL,cached:true,generation:A.descriptor.generation,entry:root+A.descriptor.generation+"/game.html"});}};
offline=true;
const cached=await prepareRuntimeLaunch(root+B.descriptor.generation+"/game.html",{baseUrl,fetchImpl,worker});
assert.equal(cached.generation,A.descriptor.generation);assert.equal(cached.cached,true);
assert.equal(messages[1].type,RUNTIME_PREPARE);assert.equal(messages[1].catalog,undefined,"failed pointer does not inject a fake current catalog");
await assert.rejects(prepareRuntimeLaunch("https://other.test/runtime/a.html",{baseUrl,fetchImpl,worker:null}),/outside/);
await assert.rejects(prepareRuntimeLaunch(root+"game.html",{baseUrl,fetchImpl,worker:null}),/unavailable/);
offline=false;
let stall=false, wasmAttempts=0;
const slowFetch=async(input,options)=>{
  const response=await fetchImpl(input,options);
  if (!String(input).includes(B.descriptor.generation) || !String(input).endsWith("game.wasm")) return response;
  wasmAttempts++;
  const bytes=new TextEncoder().encode(B.bodies["game.wasm"]);
  let index=0;
  return new Response(new ReadableStream({
    start(controller) {
      options.signal.addEventListener("abort",()=>controller.error(options.signal.reason),{once:true});
    },
    async pull(controller) {
      if(stall) return new Promise(()=>{});
      await new Promise(resolve=>setTimeout(resolve,25));
      if(index<bytes.length) controller.enqueue(bytes.slice(index,index+=1));
      else controller.close();
    },
  }));
};
const slow=await prepareRuntimeLaunch(root+"game.html",{baseUrl,fetchImpl:slowFetch,worker:null,timeoutMs:100});
assert.equal(slow.generation,B.descriptor.generation,"continuous transfer may take longer than the inactivity timeout");
assert.equal(wasmAttempts,1,"healthy slow transfer must not restart");
stall=true; wasmAttempts=0;
const stalled=await prepareRuntimeLaunch(root+"game.html",{baseUrl,fetchImpl:slowFetch,worker:null,timeoutMs:100});
assert.equal(stalled.generation,A.descriptor.generation,"stalled transfer still permits whole-generation fallback");
assert.equal(wasmAttempts,3,"stalled requests retain bounded retries");
console.log("Launcher latest-immediate, whole-generation retry, optional SW/storage, slow/stalled downloads and DATA identity separation: PASS");
