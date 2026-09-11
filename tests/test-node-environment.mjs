import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { requiredNodeDependencies, installedEnvironmentMatches } from "../host/lib/node-environment.mjs";

const root=await mkdtemp(resolve(tmpdir(),"eagler-node-env-"));
await mkdir(resolve(root,"src"),{recursive:true});
await writeFile(resolve(root,"src","app.mts"),"export {};\n");
assert.ok(requiredNodeDependencies(root).includes("typescript"),"source checkout must require the TS compiler");
const pre=await mkdtemp(resolve(tmpdir(),"eagler-node-env-pre-"));
assert.ok(!requiredNodeDependencies(pre).includes("typescript"),"prebuilt bundle must not require source compiler");
const required=requiredNodeDependencies(root);
const packages={"":{}};
for(const name of required){packages[`node_modules/${name}`]={version:"1.0.0"};await mkdir(resolve(root,"node_modules",name),{recursive:true});await writeFile(resolve(root,"node_modules",name,"package.json"),JSON.stringify({name,version:"1.0.0"}));}
const lock=JSON.stringify({lockfileVersion:3,packages});
await writeFile(resolve(root,"package-lock.json"),lock);
const identity=createHash("sha256").update(lock).digest("hex");
await writeFile(resolve(root,"node_modules",".eagler-host-lock.json"),JSON.stringify({schema:"eagler-touhou/node-environment/1",lockSha256:identity,nodeMajor:Number.parseInt(process.versions.node,10),required}));
assert.equal(await installedEnvironmentMatches(root,required,identity),true);
packages[`node_modules/${required[0]}`].version="2.0.0";
await writeFile(resolve(root,"package-lock.json"),JSON.stringify({lockfileVersion:3,packages}));
assert.equal(await installedEnvironmentMatches(root,required,identity),false,"lock/install drift must invalidate environment");
console.log("Node environment contract: PASS");
