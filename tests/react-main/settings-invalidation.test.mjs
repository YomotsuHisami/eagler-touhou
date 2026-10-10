/** Supplemental source-derived policy tests. Original browser scenarios remain
 * primary acceptance; this does not exercise native Runtime or saved files.
 * Main app.mts4880–4904,6587–6617,8680–8705,8737–8739,8914–8943,8531–8538. */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const project = fileURLToPath(new URL('../../', import.meta.url));
let work, api;
before(async () => {
  await mkdir(resolve(project, '.cache'), {recursive: true});
  work = await mkdtemp(resolve(project, '.cache/react-main-settings-policy-'));
  const outfile = resolve(work, 'model.mjs');
  await build({absWorkingDir: project, entryPoints: ['app/models/game-settings.ts'], outfile,
    bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{name: 'main-authored-mts', setup(context) {
      context.onResolve({filter: /^\.\.?\/.*\.mjs$/}, args => {
        const source = resolve(dirname(args.importer), args.path), authored = source.slice(0, -4) + '.mts';
        return source.replaceAll('\\', '/').startsWith(resolve(project, 'src').replaceAll('\\', '/') + '/') && existsSync(authored) ? {path: authored} : undefined;
      });
    }}],
  });
  api = await import(pathToFileURL(outfile).href);
});
after(async () => {if (work) await rm(work, {recursive: true, force: true});});

function fixture(productId = 'th06') {
  const changes = [], context = {productId, uiLocale: 'en', mobile: false,
    webMidiAvailable: true, languages: [{id: 'ja', pack: null}, {id: 'lang_en', pack: null}],
    musicAvailability: {audio: true, midiAvailable: true, importServer: false, remoteOggAdvertised: true}};
  const model = api.createGameSettingsModel({storage: null, onChange: change => changes.push(change)});
  model.hydrate(context);
  return {model, context, changes, reset: () => api.settingsChangeResetsRuntime(changes.at(-1))};
}

test('main ordinary setOption resets; live sensitivity and opacity do not', () => {
  const f = fixture();
  f.model.setOption('touchEnabled', !f.model.getSnapshot().options.touchEnabled); assert.equal(f.reset(), true);
  f.model.setOption('touchMovementMode', 'joystick'); assert.equal(f.reset(), true);
  f.model.setOption('touchSensitivity', 175); assert.equal(f.reset(), false);
  f.model.previewSensitivity(205); assert.equal(f.reset(), false);
  f.model.setOption('touchControlOpacity', 45); assert.equal(f.reset(), false);
  f.model.setOption('frameLimit60Enabled', !f.model.getSnapshot().options.frameLimit60Enabled); assert.equal(f.reset(), true);
  f.model.setOption('externalMidiDeviceId', 'selected-output'); assert.equal(f.reset(), true, 'main4483 uses setOption for a selected output');
});

test('main library language/music change only; unchanged selection is not invalidation', () => {
  const f = fixture();
  f.model.setLanguage('ja'); assert.equal(f.reset(), true);
  f.model.setLanguage('ja'); assert.equal(f.reset(), false);
  f.model.setMusic('none'); assert.equal(f.reset(), true);
  f.model.setMusic('none'); assert.equal(f.reset(), false);
  const current = f.model.getSnapshot();
  assert.equal(api.settingsChangeResetsRuntime({previous: {...current, musicPreferenceExplicit: false}, current, reason: 'music'}), true,
    'selecting the same effective mode can make a previously implicit preference explicit');
});

test('main lobby language/music/frame limit persist without reset; ordinary options and sharing reset', () => {
  const f = fixture('th06mp');
  f.model.setLanguage('ja'); assert.equal(f.reset(), false);
  f.model.setMusic('none'); assert.equal(f.reset(), false);
  f.model.setOption('frameLimit60Enabled', !f.model.getSnapshot().options.frameLimit60Enabled); assert.equal(f.reset(), false);
  f.model.setOption('alwaysHitbox', !f.model.getSnapshot().options.alwaysHitbox); assert.equal(f.reset(), true);
  f.model.setOption('externalMidiDeviceId', 'selected-output'); assert.equal(f.reset(), true);
  f.model.setShareSingleplayerSettings(!f.model.getSnapshot().shareSingleplayerSettings); assert.equal(f.reset(), true);
});

test('main actual product change resets; initial/same-product hydrate and context/presentation do not', () => {
  const f = fixture(); assert.equal(f.reset(), false);
  f.model.hydrate(f.context); assert.equal(f.reset(), false);
  f.model.setDisclosure('advanced', true); assert.equal(f.reset(), false);
  f.model.refreshContext({...f.context, mobile: true}); assert.equal(f.reset(), false);
  f.model.hydrate({...f.context, productId: 'th07'}); assert.equal(f.reset(), true);
});

test('main552–554: room-rule changes preserve session language/music when storage rejects writes', () => {
  const original = fixture('th06mp'), changes = [];
  const model = api.createGameSettingsModel({storage: {getItem() {return null;},
    setItem() {throw new Error('blocked storage');}, removeItem() {throw new Error('blocked storage');}},
    onChange: change => changes.push(change)});
  model.hydrate(original.context); model.setLanguage('ja'); model.setMusic('none');
  const before = model.getSnapshot();
  model.setMovementRestriction(true);
  const after = model.getSnapshot();
  assert.equal(after.language, 'ja'); assert.equal(after.music, 'none');
  assert.deepEqual(after.options, before.options);
  assert.equal(after.context.forbidUnlimitedMovement, true);
  assert.equal(changes.at(-1).reason, 'context');
  assert.equal(api.settingsChangeResetsRuntime(changes.at(-1)), false);
  const revision = after.revision; model.setMovementRestriction(true);
  assert.equal(model.getSnapshot().revision, revision, 'unchanged restriction does not publish');
});

test('main4881: the current room restriction rejects unlimited synchronously before persistence', () => {
  const f = fixture('th06mp');
  f.model.setMovementRestriction(true);
  const before = f.model.getSnapshot();
  assert.throws(() => f.model.setOption('touchMovementMode', 'touch-unlimited'), /room\.movementRequired/);
  assert.equal(f.model.getSnapshot(), before, 'refusal changes neither options nor snapshot');
  f.model.setMovementRestriction(false);
  f.model.setOption('touchMovementMode', 'touch-unlimited');
  assert.equal(f.model.getSnapshot().options.touchMovementMode, 'touch-unlimited');
});

test('main9742/1519: boot preview is a temporary option write overwritten by first Host defaults', () => {
  const f = fixture(), before = f.model.getSnapshot();
  assert.equal(before.options.touchEnabled, false);
  f.model.applyBootTouchPreview(); const preview = f.model.getSnapshot();
  assert.equal(preview.options.touchEnabled, true); assert.equal(f.changes.at(-1).reason, 'preview');
  assert.equal(f.reset(), false);
  assert.deepEqual({...preview, options: before.options, revision: before.revision}, before,
    'preview changes only touchEnabled and publication revision');
  const revision = preview.revision; f.model.applyBootTouchPreview();
  assert.equal(f.model.getSnapshot().revision, revision, 'already-enabled preview needs no new publication');
  f.model.restoreHostPreferences(f.context);
  assert.equal(f.model.getSnapshot().options.touchEnabled, false);
  assert.equal(f.changes.at(-1).reason, 'host-restore'); assert.equal(f.reset(), false);
  f.model.refreshContext({...f.context, mobile: true});
  assert.equal(f.model.getSnapshot().options.touchEnabled, false, 'metadata refresh does not reapply a sticky preview override');
});

test('main9744: boot preview does not persist; first Host rereads the stored disabled preference', () => {
  const context = fixture().context, values = new Map(), writes = [], changes = [];
  const model = api.createGameSettingsModel({storage: {getItem: key => values.get(key) ?? null,
    setItem(key, value) {writes.push([key, value]); values.set(key, value);}, removeItem: key => values.delete(key)},
    onChange: change => changes.push(change)});
  model.hydrate(context); model.setOption('touchEnabled', true); model.setOption('touchEnabled', false);
  const saved = [...values], count = writes.length;
  model.applyBootTouchPreview();
  assert.equal(model.getSnapshot().options.touchEnabled, true);
  assert.equal(writes.length, count); assert.deepEqual([...values], saved);
  model.restoreHostPreferences(context);
  assert.equal(model.getSnapshot().options.touchEnabled, false);
  assert.equal(api.settingsChangeResetsRuntime(changes.at(-1)), false);
});

test('main1500–1521: Host subset fallback rereads another product without signaling Runtime invalidation', () => {
  const f = fixture(); f.model.setOption('touchEnabled', true);
  f.model.restoreHostPreferences({...f.context, productId: 'th07'});
  assert.equal(f.model.getSnapshot().context.productId, 'th07');
  assert.equal(f.model.getSnapshot().gameId, 'th07');
  assert.equal(f.changes.at(-1).reason, 'host-restore'); assert.equal(f.reset(), false);
  f.model.hydrate({...f.context, productId: 'th08'});
  assert.equal(f.reset(), true, 'a later actual user product selection retains its original invalidation policy');
});

test('main9755–9771: pointer-priority changes preserve blocked-storage session choices and disclosures', () => {
  const context = fixture().context, changes = []; let writes = 0;
  const model = api.createGameSettingsModel({storage: {getItem() {return null;},
    setItem() {writes++; throw new Error('blocked storage');}, removeItem() {writes++; throw new Error('blocked storage');}},
    onChange: change => changes.push(change)});
  model.hydrate(context); model.setLanguage('ja'); model.setMusic('none');
  model.setDisclosure('touch', false); model.setDisclosure('advanced', true);
  const before = model.getSnapshot(), count = writes;
  model.setTouchSettingsPriority(true); const after = model.getSnapshot();
  assert.equal(after.context.mobile, true);
  assert.equal(after.language, 'ja'); assert.equal(after.music, 'none');
  assert.deepEqual(after.options, before.options); assert.deepEqual(after.disclosure, before.disclosure);
  assert.equal(writes, count); assert.equal(changes.at(-1).reason, 'context');
  assert.equal(api.settingsChangeResetsRuntime(changes.at(-1)), false);
  const revision = after.revision; model.setTouchSettingsPriority(true);
  assert.equal(model.getSnapshot().revision, revision, 'unchanged priority does not publish');
  model.setTouchSettingsPriority(false);
  assert.deepEqual(model.getSnapshot().disclosure, before.disclosure);
  assert.equal(model.getSnapshot().language, 'ja'); assert.equal(writes, count);
});

test('main4697–4702: metadata/hint refresh preserves blocked-storage language/options while updating effective music', () => {
  const context = fixture().context, changes = []; let reads = 0, writes = 0;
  const model = api.createGameSettingsModel({storage: {getItem() {reads++; return null;},
    setItem() {writes++; throw new Error('blocked storage');}, removeItem() {writes++; throw new Error('blocked storage');}},
    onChange: change => changes.push(change)});
  model.hydrate(context); model.setLanguage('lang_en'); model.setMusic('ogg-stream');
  model.setOption('touchEnabled', true); model.setOption('externalMidiDeviceId', 'disconnected-output');
  model.setOption('thpracEnabled', true); model.setDisclosure('advanced', true);
  const before = model.getSnapshot(), readCount = reads, writeCount = writes;
  const updated = {...context, webMidiAvailable: false, languages: [{id: 'ja', pack: null}],
    musicAvailability: {...context.musicAvailability, audio: false}};
  model.refreshContext(updated); const after = model.getSnapshot();
  assert.equal(after.language, 'lang_en', 'catalog rendering does not overwrite a missing selected language');
  assert.deepEqual(after.options, before.options); assert.deepEqual(after.disclosure, before.disclosure);
  assert.equal(after.music, 'none'); assert.equal(after.musicPreference, 'ogg-stream');
  assert.equal(after.context, updated); assert.equal(reads, readCount); assert.equal(writes, writeCount);
  assert.equal(api.settingsChangeResetsRuntime(changes.at(-1)), false);
});

test('main4750–4751: metadata retains only the original unavailable-thprac render normalization', () => {
  const f = fixture(); f.model.setOption('thpracEnabled', true); f.model.setOption('externalMidiDeviceId', 'keep-output');
  f.model.refreshContext({...f.context, hostFeatures: {thprac: false}, webMidiAvailable: false});
  assert.equal(f.model.getSnapshot().options.thpracEnabled, false);
  assert.equal(f.model.getSnapshot().options.externalMidiDeviceId, 'keep-output'); assert.equal(f.reset(), false);
});

test('main4840–4845: explicit unlaunched locale restoration rereads defaults without Runtime invalidation', () => {
  const context = {...fixture().context, languages: [{id: 'ja', pack: null}, {id: 'lang_en', pack: null}, {id: 'lang_zh-hans', pack: null}]};
  const changes = []; let reads = 0;
  const model = api.createGameSettingsModel({storage: {getItem() {reads++; return null;},
    setItem() {throw new Error('blocked storage');}, removeItem() {throw new Error('blocked storage');}},
    onChange: change => changes.push(change)});
  model.hydrate(context); model.setLanguage('ja'); model.setOption('touchEnabled', true);
  model.setOption('externalMidiDeviceId', 'session-output'); model.setDisclosure('advanced', true);
  const readCount = reads;
  model.restoreLocalePreferences({...context, uiLocale: 'zh-CN'}); const after = model.getSnapshot();
  assert.ok(reads > readCount); assert.equal(after.language, 'lang_zh-hans');
  assert.equal(after.options.touchEnabled, false); assert.equal(after.options.externalMidiDeviceId, '');
  assert.equal(after.options.thpracEnabled, true, 'locale default is restored through canonical main preferences');
  assert.equal(after.disclosure.advanced, true); assert.equal(changes.at(-1).reason, 'locale-restore');
  assert.equal(api.settingsChangeResetsRuntime(changes.at(-1)), false);
});
