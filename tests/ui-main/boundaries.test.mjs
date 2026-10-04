import test from 'node:test';
import assert from 'node:assert/strict';
import {boundaryViolations} from '../../scripts/check-ui-boundaries.mjs';
test('core and service imports reject React, UI and reverse dependencies', () => {
 for (const [path, code] of [
  ['src/contracts/demo.mts', "import type {ReactNode} from 'react';"],
  ['package/demo.d.mts', "export const view: import('react').ReactNode;"],
  ['lib/demo.mjs', "export {x} from '../app/root';"],
  ['app/services/demo.ts', "const module = import('react-router');"],
  ['app/services/demo.ts', "import {View} from '../components/View';"],
 ]) assert.ok(boundaryViolations(path, code).length, path);
});
test('service DOM queries and direct application history are rejected', () => {
 for (const code of ["document.querySelector('button');", "document['createElement']('div');", "document.querySelectorAll?.('a');"])
  assert.ok(boundaryViolations('app/services/demo.ts',code).length, code);
 for (const code of ["history.pushState({},'');", "window.history.back();", "history['replaceState']({},'');"])
  assert.ok(boundaryViolations('app/routes/demo.tsx',code).length, code);
});
test('ordinary core, injected browser ports and React views retain their valid owners', () => {
 assert.deepEqual(boundaryViolations('src/contracts/demo.mts', 'export interface Item {id:string}'), []);
 assert.deepEqual(boundaryViolations('app/services/demo.ts', 'export const make = (storage: Storage) => storage.getItem("value");'), []);
 assert.deepEqual(boundaryViolations('app/routes/demo.tsx', "import {Link} from 'react-router'; export const View=()=> <Link to='/'>Home</Link>;"), []);
});
