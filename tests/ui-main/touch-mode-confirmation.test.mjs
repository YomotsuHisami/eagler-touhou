/** Confirmation gate is the only write boundary for warned touch modes. */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = fileURLToPath(new URL('../..', import.meta.url));
await mkdir(join(root, '.cache'), {recursive: true});
const directory = await mkdtemp(join(root, '.cache/ui-touch-confirmation-test-'));
after(() => rm(directory, {recursive: true, force: true}));
const bundle = await build({
  stdin: {contents: "export * from './app/services/touch-mode-confirmation.ts';", resolveDir: root, loader: 'ts'},
  bundle: true, format: 'esm', platform: 'node', write: false,
});
const file = join(directory, 'touch-mode-confirmation.mjs');
await writeFile(file, bundle.outputFiles[0].text);
const {createTouchModeConfirmation, touchModeWarning} = await import(pathToFileURL(file).href);

test('only unlimited drag and free joystick require the main warnings', () => {
  assert.equal(touchModeWarning('touch'), null);
  assert.equal(touchModeWarning('joystick'), null);
  assert.equal(touchModeWarning('touch-unlimited'), 'touch.unlimitedWarning');
  assert.equal(touchModeWarning('joystick-free'), 'touch.freeStickWarning');
});

test('cancel leaves movement and enable preferences unchanged; acceptance commits each write', async () => {
  let movement = 'joystick', touchEnabled = false, accepted = false;
  const prompts = [];
  const confirm = createTouchModeConfirmation(async warning => {
    prompts.push(warning);
    return accepted;
  });

  assert.equal(await confirm('touch-unlimited', () => {movement = 'touch-unlimited';}), false);
  assert.equal(movement, 'joystick');
  accepted = true;
  assert.equal(await confirm('touch-unlimited', () => {movement = 'touch-unlimited';}), true);
  assert.equal(movement, 'touch-unlimited');

  accepted = false;
  assert.equal(await confirm(movement, () => {touchEnabled = true;}), false);
  assert.equal(touchEnabled, false);
  accepted = true;
  assert.equal(await confirm(movement, () => {touchEnabled = true;}), true);
  assert.equal(touchEnabled, true);
  assert.deepEqual(prompts, ['touch.unlimitedWarning', 'touch.unlimitedWarning', 'touch.unlimitedWarning', 'touch.unlimitedWarning']);
});

test('free-direction joystick selection also keeps its preference unchanged until accepted', async () => {
  let movement = 'joystick';
  const prompts = [];
  const confirm = createTouchModeConfirmation(async warning => {prompts.push(warning);return false;});
  assert.equal(await confirm('joystick-free', () => {movement = 'joystick-free';}), false);
  assert.equal(movement, 'joystick');
  assert.deepEqual(prompts, ['touch.freeStickWarning']);
});

test('ordinary movement mode commits without opening a confirmation', async () => {
  const prompts = [];
  const confirm = createTouchModeConfirmation(async warning => {prompts.push(warning);return false;});
  let movement = 'joystick';
  assert.equal(await confirm('touch', () => {movement = 'touch';}), true);
  assert.equal(movement, 'touch');
  assert.deepEqual(prompts, []);
});
