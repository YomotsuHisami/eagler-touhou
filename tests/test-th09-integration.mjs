import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PRODUCT_GAMES } from '../lib/contracts/product-catalog.mjs';
import { PRODUCT_CONTENT } from '../lib/content-definition.mjs';
import { assertRuntimeDataShell } from '../lib/runtime-data-provider.mjs';
import { assertRuntimeProtocolSources } from '../lib/runtime-protocol-shell.mjs';
import { runtimeFileNames } from '../lib/runtime-release.mjs';
import { workspacePath } from '../lib/workspace-layout.mjs';

const product = PRODUCT_GAMES.th09;
const html = await readFile(workspacePath('th09', 'th09_web', 'sdl-runtime', 'managed.html'), 'utf8');
const shell = await readFile(workspacePath('th09', 'th09_web', 'sdl-runtime', 'managed.mjs'), 'utf8');
const nativeInput = await readFile(workspacePath('th09', 'th09_web', 'cpp', 'sdl', 'Application.cpp'), 'utf8');
assertRuntimeDataShell(html, 'th09', 'normal');
assertRuntimeProtocolSources([{ name: 'th09.html', source: html }, { name: 'shell.mjs', source: shell }], 'th09', 'normal');
assert.equal(product.dataProvider, 'retail-memory');
assert.equal(product.runtimeFileLayout, 'directory');
assert.equal(product.package.dataTarget, '/th09.data');
assert.deepEqual(product.package.rawDataImport.fileNames, ['th09.dat']);
assert.equal(product.storage.saveRoot, '/savesth09');
assert.equal(product.package.musicMounts.ogg, '/music');
assert.equal(PRODUCT_CONTENT.th09.music.ogg.files.length, 19);
const verifiedMusic = JSON.parse(await readFile(workspacePath('th09', 'th09_web', 'assets', 'sdl-native', 'music-verification.json'), 'utf8'));
assert.deepEqual(PRODUCT_CONTENT.th09.music.ogg.files, verifiedMusic.map(track => track.file));
assert.ok(shell.includes("core.FS.writeFile('/th09.dat'"));
// The Runtime keeps ordinary and multiplayer saves apart, so the mount target
// is the variant's own root rather than the literal single-player path.
assert.match(shell, /runtimeVariant==='multiplayer'\?'\/savesth09mp':'\/savesth09'/, 'TH09 must isolate multiplayer saves from the story saves');
assert.match(shell, /core\.FS\.mount\(core\.IDBFS,\{\},saveRoot\)/, 'TH09 must mount its variant save root through IDBFS');
assert.ok(shell.includes("core.FS.symlink(saveRoot,'/save')"), 'TH09 must expose the variant save root as /save');
assert.ok(shell.includes("core.FS.symlink('/msgothic.ttc','/fonts/msgothic.ttc')"), 'TH09 must link the shared font into /fonts');
assert.match(nativeInput, /state\.context==1&&gestures\.enabled&&gestures\.fire&&!keys\[90\]/,
  'TH09 auto-fire must be inactive when touch controls are disabled');
assert.match(html, /#canvas\{display:block;width:min\(100vw,133\.333333vh\)/,
  'TH09 must retain its canvas fit when an external stylesheet is unavailable');
for (const marker of ['SDL_GetGamepads', 'SDL_OpenGamepad', 'SDL_GetGamepadButton', 'SDL_GetGamepadAxis', 'th09_keyboard_gamepad_dpad']) {
  assert.ok(nativeInput.includes(marker), `missing normalized gamepad path ${marker}`);
}
assert.doesNotMatch(nativeInput, /SDL_(?:Open|Get|Close)Joystick|SDL_GetJoysticks/);
for (const name of ['th09.html', 'shell.mjs', 'th09.mjs', 'th09.wasm', 'fonts/cp932.bin', 'fonts/blend.bin']) {
  assert.ok(product.runtimeAssets.includes(name), `missing Runtime asset ${name}`);
}
assert.deepEqual(runtimeFileNames('th09', Object.fromEntries(product.runtimeAssets.map(name => [name, {}]))), product.runtimeAssets);
console.log('TH09 Launcher/Runtime source contract: PASS');
