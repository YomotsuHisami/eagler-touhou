import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = new URL('../..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const output = await build({entryPoints: [join(root, 'app/services/game-package-import.ts')],
  bundle: true, format: 'esm', platform: 'node', write: false});
const directory = await mkdtemp(join(tmpdir(), 'game-package-import-'));
after(() => rm(directory, {recursive: true, force: true}));
const bundle = join(directory, 'game-package-import.mjs');
await writeFile(bundle, output.outputFiles[0].text);
const {installSelectedGamePackage, requestPersistentStorageBestEffort} = await import(pathToFileURL(bundle).href);

const file = {name: 'touhou-package.zip'};
const review = {id: 'review-1', kind: 'import', productId: 'th06mp', gameId: 'th06'};

test('one file choice is inspected and installed without a second UI confirmation', async () => {
  const calls = [];
  const controller = {
    async inspectImport(productId, selected, fileName) {
      calls.push(['inspect', productId, selected, fileName]);
      return review;
    },
    async confirm(reviewId) {calls.push(['confirm', reviewId]);},
  };

  await installSelectedGamePackage(controller, 'th06mp', file);
  assert.deepEqual(calls, [
    ['inspect', 'th06mp', file, 'touhou-package.zip'],
    ['confirm', 'review-1'],
  ]);
});

test('successful local package import requests persistent storage after commit without waiting on the browser', async () => {
  const calls = [];
  const controller = {
    async inspectImport() {calls.push('inspect'); return review;},
    async confirm() {calls.push('confirm');},
  };
  await installSelectedGamePackage(controller, 'th06mp', file, () => {calls.push('persist');});
  assert.deepEqual(calls, ['inspect', 'confirm', 'persist']);

  const pending = new Promise(() => {});
  const storageCalls = [];
  requestPersistentStorageBestEffort({persist() {storageCalls.push('persist'); return pending;}});
  assert.deepEqual(storageCalls, ['persist']);
  assert.doesNotThrow(() => requestPersistentStorageBestEffort({persist() {throw new Error('permission unavailable');}}));
});

test('storage persistence failure cannot turn a completed import into a failed import', async () => {
  const calls = [];
  const controller = {
    async inspectImport() {calls.push('inspect'); return review;},
    async confirm() {calls.push('confirm');},
  };
  await installSelectedGamePackage(controller, 'th06mp', file, () => {throw new Error('permission unavailable');});
  assert.deepEqual(calls, ['inspect', 'confirm']);
});

test('invalid or wrong-game selections never reach Package installation', async () => {
  let commits = 0;
  const controller = {
    async inspectImport() {return {...review, productId: 'th07mp', gameId: 'th07'};},
    async confirm() {commits++;},
  };

  await assert.rejects(installSelectedGamePackage(controller, 'th06mp', file), /does not match this game/);
  assert.equal(commits, 0);

  const invalid = {
    async inspectImport() {throw new Error('invalid package');},
    async confirm() {commits++;},
  };
  await assert.rejects(installSelectedGamePackage(invalid, 'th06mp', file), /invalid package/);
  assert.equal(commits, 0);
});
