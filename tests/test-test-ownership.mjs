/** L0/repository governance. Proves every executable test has exactly one
 * discoverable lane: a default plan or an explicit package command. */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  REPOSITORY_NODE_TESTS,
  REPOSITORY_PYTHON_TESTS,
  WORKSPACE_NODE_TESTS,
  WORKSPACE_PYTHON_TESTS,
} from "./test-plan.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const explicit = new Set(Object.values(packageJson.scripts || {}).flatMap(command =>
  [...String(command).matchAll(/(?:^|\s)(tests\/[A-Za-z0-9_./-]+\.(?:mjs|py|ps1))(?=\s|$)/g)].map(match => match[1])
));
const planned = new Set([
  ...REPOSITORY_NODE_TESTS, ...REPOSITORY_PYTHON_TESTS,
  ...WORKSPACE_NODE_TESTS, ...WORKSPACE_PYTHON_TESTS,
]);

async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(path));
    else if (/^test.*\.(?:mjs|py|ps1)$/i.test(entry.name)) files.push(relative(root, path).replaceAll("\\", "/"));
  }
  return files;
}

const exempt = new Set(["tests/test-plan.mjs"]);
const executableTests = (await collect(resolve(root, "tests"))).filter(file => !exempt.has(file));
const unowned = executableTests.filter(file => !planned.has(file) && !explicit.has(file));
assert.deepEqual(unowned, [], `tests without a declared lane: ${unowned.join(", ")}`);

// An advertised current browser lane may not silently target the deleted
// renderer. Native game probes, standalone recovery pages and explicit old-SW
// fixtures remain valid; these particular names belonged to the removed UI.
for(const [command,script] of Object.entries(packageJson.scripts||{})){
  if(!command.includes(':browser')&&!['test:webkit','test:browser-capabilities','verify:practice'].includes(command))continue;
  for(const match of script.matchAll(/(?:^|\s)((?:tests|scripts)\/[A-Za-z0-9_./-]+\.(?:mjs|py))(?=\s|$)/g)){
    const source=await readFile(resolve(root,match[1]),'utf8');
    assert.doesNotMatch(source,/\b(?:window|globalThis)\.__eaglerBoot\b/,`${command}: retired boot owner is not current acceptance`);
    assert.doesNotMatch(source,/["'`]#(?:gameFrame|gamePackageImport|mpRoomView|uiLanguageSelect|launch|decisionDialog)(?:[^A-Za-z0-9_-]|$)/,
      `${command}: port current UI controls or explicitly replace the advertised lane`);
    assert.doesNotMatch(source,/\.cache\/build\/optimized\/index\.html/,
      `${command}: current acceptance must consume the Framework artifact`);
  }
}

// The combined native lane must forward the same explicit publication to both
// retained scenarios. This is a process-plan test only: no Python/browser runs.
const {runTh09LaunchBrowser}=await import('../scripts/test-th09mp-launch-browser.mjs');
const nativeEntry='tests/test-th09mp-launch.py',calls=[],environment={EAGLER_NATIVE_SITE_URL:'http://localhost:8900/nested/',PYTHON:'python-fixture'};
assert.equal(runTh09LaunchBrowser({args:[nativeEntry,'--url=http://127.0.0.1:8901/mount/','--package-zip=/local/fixture.zip'],environment,run:(...call)=>{calls.push(call);return {status:0};}}),0);
assert.equal(calls.length,2);
for(const [command,args,options] of calls){assert.equal(command,'python-fixture');assert.ok(args.includes('--url=http://127.0.0.1:8901/mount/'));assert.ok(args.includes('--package-zip=/local/fixture.zip'));assert.equal(options.env,environment);assert.equal(options.shell,false);}
assert.deepEqual(calls[0][1].slice(-2),['--host-entry=title','--touch-check']);
assert.deepEqual(calls[1][1].slice(-2),['--host-entry=card','--music=none']);
let attempted=0;
assert.equal(runTh09LaunchBrowser({args:[nativeEntry],environment,run:()=>{attempted++;return {status:7};}}),7);assert.equal(attempted,1,'failed first scenario must stop the combined lane');
assert.throws(()=>runTh09LaunchBrowser({args:['tests/unrelated.py'],run:()=>{throw Error('must not execute');}}),/Usage/);

console.log(JSON.stringify({ testOwnership: "PASS", executableTests: executableTests.length }));
