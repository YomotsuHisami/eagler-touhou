/** Deterministic fixture isolation checks; no browser or GPU is executed. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {installSyntheticBrowserCompatibilityProbe} from './synthetic-browser-compatibility-probe.ts';

function setup() {
  const nativeCalls = [], listeners = new Map();
  function HTMLCanvasElement() {}
  const native = function (...args) {nativeCalls.push({canvas: this, args}); return null;};
  HTMLCanvasElement.prototype.getContext = native;
  const document = {currentScript: null,
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name, listener) => {if (listeners.get(name) === listener) listeners.delete(name);},
  };
  runInNewContext(`(${installSyntheticBrowserCompatibilityProbe.toString()})()`, {HTMLCanvasElement, document});
  const canvas = new HTMLCanvasElement();
  return {canvas, document, listeners, native, nativeCalls, HTMLCanvasElement};
}
const gate = {id: 'browser-compatibility-gate', getAttribute: name => name === 'data-compatibility-url' ? '/nested-launcher/compatibility.html' : null};

test('UI fixture substitutes only one early gate probe then restores real canvas', () => {
  const {canvas, document, native, nativeCalls, listeners} = setup();
  const attributes = {alpha: false};
  assert.equal(canvas.getContext('webgl2', attributes), null);
  assert.equal(nativeCalls.length, 1);
  assert.equal(nativeCalls[0].canvas, canvas);
  assert.deepEqual(nativeCalls[0].args, ['webgl2', attributes]);
  document.currentScript = {id: 'runtime-script'};
  assert.equal(canvas.getContext('webgl2'), null);
  document.currentScript = gate;
  assert.equal(canvas.getContext('2d'), null);
  const probe = canvas.getContext('webgl2');
  assert.equal(probe.isContextLost(), false);
  assert.equal(probe.getExtension('anything-else'), null);
  assert.equal(probe.getExtension('WEBGL_lose_context').loseContext(), undefined);
  assert.equal(canvas.getContext, native);
  assert.equal(listeners.size, 0);
  assert.equal(canvas.getContext('webgl2'), null, 'even a repeated gate call uses the actual canvas after the one probe');
  document.currentScript = null;
  assert.equal(canvas.getContext('webgl2'), null, 'later Runtime calls must not inherit synthetic capability');
  assert.equal(nativeCalls.length, 5);
});

test('UI fixture restores native context when no compatibility gate runs', () => {
  const {canvas, document, native, listeners} = setup();
  document.currentScript = {id: 'browser-compatibility-gate', getAttribute: () => '/wrong-target'};
  assert.equal(canvas.getContext('webgl2'), null);
  listeners.get('DOMContentLoaded')();
  assert.equal(canvas.getContext, native);
  assert.equal(listeners.size, 0);
});


test('the real authored gate consumes the synthetic probe without changing later GPU checks', () => {
  const {canvas, document, native, HTMLCanvasElement} = setup();
  const redirects = [];
  document.currentScript = gate;
  document.createElement = name => {assert.equal(name, 'canvas'); return new HTMLCanvasElement();};
  document.getElementById = id => {assert.equal(id, gate.id); return gate;};
  const source = readFileSync(new URL('../../app/browser/compatibility-gate.js', import.meta.url), 'utf8');
  const scope = {document, navigator: {userAgent: 'Mozilla/5.0 Firefox/144.0'}, location: {search: '', replace: value => redirects.push(value)}};
  runInNewContext(source, scope);
  assert.deepEqual(redirects, []);
  assert.equal(canvas.getContext, native);
  assert.equal(canvas.getContext('webgl2'), null);
  runInNewContext(source, scope);
  assert.deepEqual(redirects, ['/nested-launcher/compatibility.html?reasons=webgl2&platform=desktop']);
});
