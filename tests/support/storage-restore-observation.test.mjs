/** Setup/identity/synthetic-dispatch only; never launches a browser or Runtime. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

const project = fileURLToPath(new URL('../../', import.meta.url));
const baseline = 'edee9633e5e3ee79cd2e1aa334f84f6caf755090';
const path = 'tests/test-runtime-storage-conformance.py';
const source = readFileSync(new URL('./storage-restore-observation.js', import.meta.url), 'utf8');
const python = code => JSON.parse(execFileSync('python', ['-c', code], {cwd: project, encoding: 'utf8', env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}}));
const pieces = python(`import ast,json,subprocess\nfrom pathlib import Path\na=subprocess.check_output(['git','show','${baseline}:${path}'],text=True);b=Path('${path}').read_text()\ndef parts(s):\n t=ast.parse(s);inject=next(n.value.value for n in ast.walk(t) if isinstance(n,ast.Assign) and any(isinstance(k,ast.Name) and k.id=='RESTORE_FAILURE_SCRIPT' for k in n.targets));strings=[n.value for n in ast.walk(t) if isinstance(n,ast.Constant) and isinstance(n.value,str)];events=next(s for s in strings if s.startswith('(() => {') and 'window.__storageEvents = []' in s);method=next(n for n in ast.walk(t) if isinstance(n,ast.FunctionDef) and n.name=='run_restore_failure');return {'injector':inject,'events':events,'assertions':[ast.get_source_segment(s,n) for n in ast.walk(method) if isinstance(n,ast.Assert)]}\nprint(json.dumps({'original':parts(a),'current':parts(b)}))`);
const init = (game = 'th06') => `(${source})(${JSON.stringify({game, runtimeName: `${game}.html`})})`;
const error = epoch => ({protocol: 'eagler-touhou/1', game: 'th06', epoch, event: 'error', error: 'Local save restore failed: injected restore failure'});
function fixture({arm = true, bind = true, url = '/runtime/th06/th06.html?runtimeEpoch=7'} = {}) {
  const dom = new JSDOM('<iframe id="gameFrame"></iframe>', {url: 'https://launcher.test/', runScripts: 'outside-only'});
  const window = dom.window, frame = window.document.getElementById('gameFrame');
  window.eval(init());
  const owner = window.__originalStorageRestoreObservation;
  if (arm) owner.arm();
  frame.src = url;
  const child = frame.contentWindow;
  if (bind) child.eval(init());
  function emit(message = error(7), overrides = {}) {
    window.dispatchEvent(new window.MessageEvent('message', {source: child, origin: window.location.origin, data: message, ...overrides}));
  }
  return {dom, window, frame, child, owner, emit, close: () => window.close()};
}
const plain = value => JSON.parse(JSON.stringify(value));

test('capture mode is separate and opt-in; its self-contained initializer is identical for main/React and independent of document mode', () => {
  const result = python(`import sys,json,os\nsys.path.insert(0,'tests')\nfrom support.storage_restore_observation import restore_failure_capture_enabled,install_restore_failure_capture\nclass Context:\n def __init__(self): self.scripts=[]\n def add_init_script(self,source): self.scripts.append(source)\nresults=[]\nfor mode in ['current','capture']:\n os.environ['EAGLER_STORAGE_RESTORE_OBSERVATION']=mode;c=Context();install_restore_failure_capture(c,'th06','th06.html');results.append({'enabled':restore_failure_capture_enabled(),'scripts':c.scripts})\ntry:restore_failure_capture_enabled({'EAGLER_STORAGE_RESTORE_OBSERVATION':'react'})\nexcept ValueError:results.append('rejected')\nresults.append(restore_failure_capture_enabled({}))\nprint(json.dumps(results))`);
  assert.deepEqual(result[0], {enabled: false, scripts: []});
  assert.equal(result[1].enabled, true); assert.equal(result[1].scripts.length, 1);
  assert.equal(result[2], 'rejected'); assert.equal(result[3], false);
  const f = fixture();
  try {assert.equal(f.window.__originalRuntimeDocumentObservation, undefined);}
  finally {f.close();}
  assert.ok(!source.includes('EAGLER_LAUNCHER_TEST_ROOT'));
});

test('original injector, full-launch event collector and all three failure assertions are byte-identical', () => {
  assert.deepEqual(pieces.current, pieces.original);
  assert.equal(pieces.original.assertions.length, 3);
});

for (const order of ['injector-first', 'observer-first']) test(`original injected/triggered flags are captured before later cleanup (${order})`, async () => {
  const f = fixture({bind: false});
  try {
    const inject = `(${pieces.original.injector})('th06.html')`;
    if (order === 'injector-first') {f.child.eval(inject); f.child.eval(init());}
    else {f.child.eval(init()); f.child.eval(inject);}
    f.child.FS = {syncfs() {throw new Error('Only the original injected populate callback is expected');}};
    let failed;
    f.child.Module = {preRun: [() => f.child.FS.syncfs(true, failure => {failed = failure;})]};
    f.child.Module.preRun.forEach(callback => callback());
    await Promise.resolve();
    assert.equal(failed.message, 'injected restore failure');
    const before = f.frame.contentDocument;
    f.window.addEventListener('message', () => {
      f.child.__eaglerStorageRestoreFailureInjected = false;
      f.child.__eaglerStorageRestoreFailureTriggered = false;
      f.frame.src = 'about:blank';
    });
    f.emit({...error(7), error: `Local save restore failed: ${failed.message}`});
    assert.notEqual(f.frame.contentDocument, before);
    assert.deepEqual(plain(f.owner.snapshot()), {url: 'https://launcher.test/runtime/th06/th06.html?runtimeEpoch=7', injected: true, triggered: true});
    assert.equal(Object.isFrozen(f.owner.snapshot()), true);
  } finally {f.close();}
});

test('binding is armed before the first expected child, cannot be inferred from an error and never adopts a successor', () => {
  const f = fixture({arm: false});
  try {
    f.owner.arm(); f.emit();
    assert.throws(() => f.owner.snapshot(), /No authenticated/);
    f.child.eval(init());
    assert.throws(() => f.owner.arm(), /already armed/);
    const initialDocument = f.frame.contentDocument;
    f.frame.src = '/runtime/th06/th06.html?runtimeEpoch=7';
    const successor = f.frame.contentWindow;
    assert.notEqual(successor.document, initialDocument);
    assert.equal(f.owner.bind(successor, successor.document, f.frame), false);
    successor.eval(init());
    f.window.dispatchEvent(new f.window.MessageEvent('message', {source: successor, origin: f.window.location.origin, data: error(7)}));
    f.emit();
    assert.throws(() => f.owner.snapshot(), /No authenticated/);
  } finally {f.close();}
});

test('synthetic stable-WindowProxy identity unit rejects a successor Document at the exact same URL/epoch', () => {
  // JSDOM replaces its Window on navigation; this isolated negative unit holds
  // that identity stable. It is not a browser navigation or genuine event test.
  const href = 'https://launcher.test/runtime/th06/th06.html?runtimeEpoch=7';
  const first = {URL: href}, successor = {URL: href};
  const child = {document: first, location: {href}};
  class Frame {}
  const frame = Object.assign(new Frame(), {isConnected: true, contentWindow: child, contentDocument: first});
  let receive;
  const host = {location: {origin: 'https://launcher.test'}, addEventListener(type, listener) {assert.equal(type, 'message'); receive = listener;}};
  host.parent = host;
  const context = {window: host, document: {getElementById: () => frame}, location: host.location, HTMLIFrameElement: Frame, URL};
  vm.runInNewContext(init(), context);
  const owner = host.__originalStorageRestoreObservation; owner.arm();
  assert.equal(owner.bind(child, first, frame), true);
  child.document = successor; frame.contentDocument = successor;
  assert.equal(owner.bind(child, successor, frame), false);
  receive({source: child, origin: host.location.origin, data: error(7)});
  assert.throws(() => owner.snapshot(), /No authenticated/);
});

test('false injection evidence remains false rather than being synthesized from an error marker', () => {
  const f = fixture();
  try {
    f.emit();
    assert.deepEqual(plain(f.owner.snapshot()), {url: f.child.location.href, injected: false, triggered: false});
  } finally {f.close();}
  const injectedOnly = fixture();
  try {
    injectedOnly.child.eval(`(${pieces.original.injector})('th06.html')`);
    injectedOnly.child.Module = {preRun: []}; // Hook installs; populate has not run.
    injectedOnly.emit();
    assert.equal(injectedOnly.owner.snapshot().injected, true);
    assert.equal(injectedOnly.owner.snapshot().triggered, false);
  } finally {injectedOnly.close();}
});

test('wrong source/origin/protocol/game/epoch/event/error are ignored without preventing later eligible evidence', () => {
  const cases = [
    [{}, {source: null}], [{}, {origin: 'https://foreign.test'}],
    [{protocol: 'wrong'}, {}], [{game: 'th07'}, {}], [{epoch: 6}, {}], [{epoch: '7'}, {}],
    [{epoch: 0}, {}], [{epoch: 1.5}, {}], [{event: 'fatal'}, {}], [{error: 'unrelated startup failure'}, {}], [{error: null}, {}],
  ];
  for (const [message, envelope] of cases) {
    const f = fixture();
    try {
      f.emit({...error(7), ...message}, envelope); assert.throws(() => f.owner.snapshot(), /No authenticated/);
      f.emit(); assert.equal(f.owner.snapshot().url, f.child.location.href);
    } finally {f.close();}
  }
});

test('unusable URL epochs, foreign/wrong Runtime documents and missing/detached frames cannot bind or capture', () => {
  for (const url of ['/runtime/th06/th06.html', '/runtime/th06/th06.html?runtimeEpoch=0', '/runtime/th06/th06.html?runtimeEpoch=07',
    '/runtime/th06/th06.html?runtimeEpoch=7&runtimeEpoch=8', '/runtime/th06/th06.html?runtimeEpoch=9007199254740992',
    '/runtime/th07/th07.html?runtimeEpoch=7', 'https://foreign.test/th06.html?runtimeEpoch=7']) {
    const f = fixture({url});
    try {f.emit(); assert.throws(() => f.owner.snapshot(), /No authenticated/);}
    finally {f.close();}
  }
  const f = fixture();
  try {f.frame.remove(); f.emit(); assert.throws(() => f.owner.snapshot(), /No authenticated/);}
  finally {f.close();}
});

test('URL changes after binding and authenticated ready/first-frame before failure invalidate capture', () => {
  const changed = fixture();
  try {
    changed.child.history.replaceState(null, '', '?runtimeEpoch=8'); changed.emit(error(8));
    assert.throws(() => changed.owner.snapshot(), /No authenticated/);
  } finally {changed.close();}
  for (const event of ['ready', 'first-frame']) {
    const f = fixture();
    try {f.emit({...error(7), event}); f.emit(); assert.throws(() => f.owner.snapshot(), /followed ready\/first-frame/);}
    finally {f.close();}
  }
});

test('capture does not consume events or hide a later successful retry from the unchanged full-launch collector', () => {
  const f = fixture();
  try {
    f.window.__recordStorageEvent = async () => {};
    f.window.eval(pieces.original.events);
    f.emit();
    const first = f.owner.snapshot();
    f.emit({...error(7), event: 'ready'});
    assert.equal(f.owner.snapshot(), first);
    assert.deepEqual(plain(f.window.__storageEvents).map(event => event.event), ['error', 'ready']);
    assert.equal(f.window.__storageEvents.some(event => event.event === 'ready' || event.event === 'first-frame'), true);
  } finally {f.close();}
});
