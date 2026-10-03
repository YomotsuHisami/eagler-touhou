import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRouter } from 'react-router';
import { createCloseIntentController } from '../app/navigation/close-intent.ts';

const parent = '/games/th06';
const child = `${parent}/help`;
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function fixture(t, { lazy, loader, initialEntries = ['/', parent], initialIndex = initialEntries.length - 1 } = {}) {
  const router = createMemoryRouter([
    { path: '/', Component: () => null },
    { path: parent, Component: () => null, children: [{ path: 'help', ...(lazy ? { lazy } : { Component: () => null }), loader }] },
    { path: '/games/th07', Component: () => null },
  ], { initialEntries, initialIndex });
  const calls = [];
  const controller = createCloseIntentController(() => router.state, (to, options) => {
    calls.push({ to, options });
    return router.navigate(to, options);
  });
  const unsubscribe = router.subscribe(() => controller.synchronize());
  t.after(() => { unsubscribe(); controller.setMounted(false); router.dispose(); });
  return { router, controller, calls };
}

test('Escape cancels a cold lazy panel before history commits; its late resolution cannot reopen it', async t => {
  const lazy = deferred();
  const { router, controller, calls } = fixture(t, {
    initialEntries: ['/', { pathname: parent, search: '?view=all', hash: '#settings', state: { selected: 'th06' } }],
    lazy: async () => { await lazy.promise; return { Component: () => null }; },
  });
  const opening = router.navigate(child, { state: { from: parent } });
  assert.equal(router.state.location.pathname, parent);
  assert.equal(router.state.navigation.location.pathname, child);
  assert.equal(await controller.dismissNested(parent), true);
  assert.equal(router.state.location.pathname, parent);
  assert.deepEqual(calls[0], { to: { pathname: parent, search: '?view=all', hash: '#settings' }, options: { replace: true, state: { selected: 'th06' }, preventScrollReset: true } });
  lazy.resolve();
  await opening;
  assert.equal(router.state.location.pathname, parent, 'late lazy completion must not resurrect the panel');
  await router.navigate(child, { state: { from: parent } });
  assert.equal(await controller.dismissNested(parent), true);
  assert.equal(router.state.location.pathname, parent);
  await router.navigate(-1);
  assert.equal(router.state.location.pathname, '/', 'cancel and reopen must not insert an extra parent entry');
  assert.equal(calls.filter(call => call.to === -1).length, 1, 'only the committed child may pop history');
});

test('Escape cancels a pending child loader and remains usable on the next tap', async t => {
  const loading = deferred();
  let first = true;
  const { router, controller, calls } = fixture(t, { loader: () => first ? (first = false, loading.promise) : null });
  const opening = router.navigate(child, { state: { from: parent } });
  assert.equal(router.state.navigation.location.pathname, child);
  assert.equal(await controller.dismissNested(parent), true);
  loading.resolve(null);
  await opening;
  assert.equal(router.state.location.pathname, parent);
  await router.navigate(child, { state: { from: parent } });
  assert.equal(await controller.dismissNested(parent), true);
  assert.equal(router.state.location.pathname, parent);
  assert.equal(calls.filter(call => call.to === -1).length, 1);
});

test('committed child closes before any UI render and repeated signals never double-pop', async t => {
  const { router, controller, calls } = fixture(t);
  for (let i = 0; i < 6; i++) {
    await router.navigate(child, { state: { from: parent } });
    const originKey = router.state.location.key;
    const first = controller.close(parent, undefined, originKey);
    const repeated = controller.close(parent, undefined, originKey);
    assert.equal(await first, true);
    assert.equal(await repeated, false);
    assert.equal(router.state.location.pathname, parent);
  }
  assert.equal(calls.length, 6);
  assert.ok(calls.every(call => call.to === -1));
  await router.navigate('/games/th07');
  assert.equal(controller.dismissNested(parent), null);
  assert.equal(router.state.location.pathname, '/games/th07');
});

test('Back and Forward can reopen the same location key without retaining a stale close latch', async t => {
  const { router, controller } = fixture(t);
  await router.navigate(child, { state: { from: parent } });
  const key = router.state.location.key;
  assert.equal(await controller.close(parent, undefined, key), true);
  await router.navigate(1);
  assert.equal(router.state.location.key, key);
  assert.equal(await controller.close(parent, undefined, key), true);
  assert.equal(router.state.location.pathname, parent);
});

test('direct child entry replaces to its parent instead of leaving the app', async t => {
  const { router, controller, calls } = fixture(t, { initialEntries: [child] });
  assert.equal(await controller.dismissNested(parent), true);
  assert.equal(router.state.location.pathname, parent);
  assert.deepEqual(calls, [{ to: parent, options: { replace: true } }]);
});

test('delayed validation cannot close a newer committed route or steal its close intent', async t => {
  const { router, controller, calls } = fixture(t);
  await router.navigate(child, { state: { from: parent } });
  const validation = deferred();
  const closing = controller.close(parent, () => validation.promise, router.state.location.key);
  await router.navigate('/games/th07');
  validation.resolve(true);
  assert.equal(await closing, false);
  assert.equal(router.state.location.pathname, '/games/th07');
  assert.equal(calls.length, 0);
});

test('delayed validation cannot cancel a newer pending navigation with an unchanged current location', async t => {
  const pending = deferred();
  let first = true;
  const { router, controller, calls } = fixture(t, { loader: () => first ? (first = false, null) : pending.promise });
  await router.navigate(child, { state: { from: parent } });
  const validation = deferred();
  const closing = controller.close(parent, () => validation.promise, router.state.location.key);
  const newer = router.navigate(`${child}?new=1`, { state: { from: parent } });
  assert.equal(router.state.navigation.location.search, '?new=1');
  validation.resolve(true);
  assert.equal(await closing, false);
  assert.equal(calls.length, 0);
  pending.resolve(null);
  await newer;
  assert.equal(router.state.location.search, '?new=1');
});

test('validation refusal is retryable and unmounted owners cannot navigate', async t => {
  const { router, controller, calls } = fixture(t);
  await router.navigate(child, { state: { from: parent } });
  assert.equal(await controller.close(parent, () => false), false);
  assert.equal(await controller.close(parent, () => true), true);
  await router.navigate(child, { state: { from: parent } });
  controller.setMounted(false);
  assert.equal(await controller.close(parent), false);
  assert.equal(calls.length, 1);
});

test('Escape outside this routed panel does not own settings or another product', async t => {
  const { router, controller, calls } = fixture(t);
  assert.equal(controller.dismissNested(parent), null);
  await router.navigate('/games/th07');
  assert.equal(controller.dismissNested(parent), null);
  assert.equal(calls.length, 0);
});

test('an old validation completion cannot clear a newer in-flight close', async t => {
  const { router, controller, calls } = fixture(t);
  await router.navigate(child, { state: { from: parent } });
  const oldValidation = deferred();
  const oldClose = controller.close(parent, () => oldValidation.promise, router.state.location.key);
  await router.navigate(`${child}?new=1`, { state: { from: child } });
  const nextValidation = deferred();
  const newKey = router.state.location.key;
  const newClose = controller.close(parent, () => nextValidation.promise, newKey);
  oldValidation.resolve(true);
  assert.equal(await oldClose, false);
  assert.equal(await controller.close(parent, undefined, newKey), false, 'new intent remains authoritative');
  assert.equal(calls.length, 0);
  nextValidation.resolve(true);
  assert.equal(await newClose, true);
  assert.equal(calls.length, 1);
  assert.equal(router.state.location.search, '');
});

test('an Escape owner on the prior game cannot cancel another product’s pending navigation', async t => {
  const loading = deferred();
  const router = createMemoryRouter([
    { path: parent, Component: () => null, children: [{ path: 'help', Component: () => null }] },
    { path: '/games/th07', Component: () => null, loader: () => loading.promise },
  ], { initialEntries: [parent, { pathname: child, state: { from: parent } }] });
  const calls = [];
  const controller = createCloseIntentController(() => router.state, (...args) => { calls.push(args); return router.navigate(...args); });
  t.after(() => router.dispose());
  const newer = router.navigate('/games/th07');
  assert.equal(controller.dismissNested(parent), null);
  assert.equal(calls.length, 0);
  loading.resolve(null);
  await newer;
  assert.equal(router.state.location.pathname, '/games/th07');
});

test('a trailing slash on the parent does not make an ordinary settings form an open panel', async t => {
  const { controller, calls } = fixture(t, { initialEntries: [`${parent}/`] });
  assert.equal(controller.dismissNested(parent), null);
  assert.equal(calls.length, 0);
});

const recordedChild = () => ({ pathname: child, state: { from: parent } });

test('pending Forward closes the entered child with one POP, preserving parent and forward history', async t => {
  const gate = deferred();
  const { router, controller, calls } = fixture(t, { initialEntries: ['/', parent, recordedChild()], initialIndex: 1, loader: () => gate.promise });
  const parentKey = router.state.location.key;
  const opening = router.navigate(1);
  assert.equal(router.state.navigation.historyAction, 'POP');
  assert.equal(await controller.dismissNested(parent), true);
  gate.resolve(null); await opening;
  assert.equal(router.state.location.key, parentKey);
  assert.deepEqual(calls, [{ to: -1, options: undefined }]);
  await router.navigate(-1); assert.equal(router.state.location.pathname, '/');
  await router.navigate(1); assert.equal(router.state.location.pathname, parent);
  await router.navigate(1); assert.equal(router.state.location.pathname, child);
});

test('pending Back into a recorded child closes toward its recorded parent without replacing the child', async t => {
  const gate = deferred();
  const { router, controller, calls } = fixture(t, { initialEntries: ['/', parent, recordedChild(), parent], initialIndex: 3, loader: () => gate.promise });
  const opening = router.navigate(-1);
  assert.equal(await controller.dismissNested(parent), true);
  gate.resolve(null); await opening;
  assert.equal(router.state.location.pathname, parent);
  assert.equal(calls.length, 1); assert.equal(calls[0].to, -1);
  await router.navigate(-1); assert.equal(router.state.location.pathname, '/');
  await router.navigate(1); await router.navigate(1); assert.equal(router.state.location.pathname, child);
});

test('settling a POP at the same parent key releases its latch for the next cold PUSH', async t => {
  let gate = deferred();
  const { router, controller, calls } = fixture(t, { initialEntries: ['/', parent, recordedChild()], initialIndex: 1, loader: () => gate.promise });
  const parentKey = router.state.location.key;
  const forwarded = router.navigate(1);
  assert.equal(await controller.dismissNested(parent), true);
  gate.resolve(null); await forwarded;
  assert.equal(router.state.location.key, parentKey);
  gate = deferred();
  const opened = router.navigate(child, { state: { from: parent } });
  assert.equal(router.state.navigation.historyAction, 'PUSH');
  assert.equal(await controller.dismissNested(parent), true);
  gate.resolve(null); await opened;
  assert.equal(router.state.location.pathname, parent);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].to, -1);
  assert.equal(calls[1].options.replace, true);
  await router.navigate(-1); assert.equal(router.state.location.pathname, '/');
});

test('pending POP with no recorded same-app parent uses explicit fallback, never an unproven pop', async t => {
  const gate = deferred();
  const { router, controller, calls } = fixture(t, { initialEntries: ['/', child, parent], initialIndex: 2, loader: () => gate.promise });
  const opening = router.navigate(-1);
  assert.equal(await controller.dismissNested(parent), true);
  gate.resolve(null); await opening;
  assert.deepEqual(calls, [{ to: parent, options: { replace: true } }]);
  await router.navigate(-1); assert.equal(router.state.location.pathname, '/');
});

test('pending POP uses the target child state, not a misleading current parent from marker', async t => {
  const gate = deferred();
  const { router, controller, calls } = fixture(t, { initialEntries: ['/', child, { pathname: parent, state: { from: '/' } }], initialIndex: 2, loader: () => gate.promise });
  const opening = router.navigate(-1);
  await controller.dismissNested(parent);
  gate.resolve(null); await opening;
  assert.deepEqual(calls, [{ to: parent, options: { replace: true } }]);
});

test('duplicate pending POP close signals stay latched while the returning navigation remains pending', async () => {
  const gate = deferred();
  const origin = { key: 'parent', pathname: parent, search: '', hash: '', state: null };
  const target = { key: 'child', pathname: child, search: '', hash: '', state: { from: parent } };
  let state = { location: origin, navigation: { historyAction: 'POP', location: target } };
  const calls = [];
  const controller = createCloseIntentController(() => state, (to, options) => { calls.push({ to, options }); return gate.promise; });
  const first = controller.dismissNested(parent);
  assert.equal(await controller.dismissNested(parent), false);
  state = { location: origin, navigation: { historyAction: 'POP', location: origin } };
  controller.synchronize();
  assert.equal(await controller.close(parent), false, 'a second callback must not pop again during the return');
  assert.equal(calls.length, 1);
  state = { location: origin, navigation: {} };
  controller.synchronize(); gate.resolve(); await first;
  state = { location: origin, navigation: { historyAction: 'PUSH', location: target } };
  assert.equal(await controller.dismissNested(parent), true, 'a later cold open may close');
});

test('existing pending PUSH cancellation still replaces the current parent and adds no entry', async t => {
  const gate = deferred();
  const { router, controller, calls } = fixture(t, { initialEntries: ['/', parent], initialIndex: 1, loader: () => gate.promise });
  const opening = router.navigate(child, { state: { from: parent } });
  await controller.dismissNested(parent); gate.resolve(null); await opening;
  assert.equal(calls.length, 1); assert.equal(calls[0].options.replace, true);
  assert.equal(calls[0].options.preventScrollReset, true);
  await router.navigate(-1); assert.equal(router.state.location.pathname, '/');
});

test('query panel closes in the router/React commit gap without losing unrelated query/hash',async t=>{
 const{router,controller}=fixture(t,{initialEntries:['/',{pathname:parent,search:'?music=midi',hash:'#settings'}]});
 await router.navigate(`${parent}?music=midi&panel=donation#settings`,{state:{from:`${parent}?music=midi#settings`}});
 assert.equal(await controller.dismissQuery('panel',['first-use','donation']),true);
 assert.equal(router.state.location.pathname,parent);assert.equal(router.state.location.search,'?music=midi');assert.equal(router.state.location.hash,'#settings');
 await router.navigate(-1);assert.equal(router.state.location.pathname,'/');
});
test('automatic query panel replacement cannot pop an unrelated previous entry',async t=>{
 const{router,controller}=fixture(t,{initialEntries:['/games/th07',parent]});
 await router.navigate(`${parent}?panel=first-use`,{replace:true,state:null});
 assert.equal(await controller.dismissQuery('panel',['first-use','donation']),true);
 assert.equal(router.state.location.pathname,parent);assert.equal(router.state.location.search,'');
 await router.navigate(-1);assert.equal(router.state.location.pathname,'/games/th07');
});
test('pending query panel cancels without creating history or resurrecting on late loader',async t=>{
 const gate=deferred();const router=createMemoryRouter([{path:'/',Component:()=>null},{path:parent,Component:()=>null,loader:({request})=>new URL(request.url).searchParams.has('panel')?gate.promise:null}],{initialEntries:['/',parent]});
 await new Promise(resolve=>setTimeout(resolve,0));
 const controller=createCloseIntentController(()=>router.state,(...args)=>router.navigate(...args));const off=router.subscribe(()=>controller.synchronize());t.after(()=>{off();router.dispose();});
 const open=router.navigate(`${parent}?panel=donation`,{state:{from:parent}});
 assert.equal(await controller.dismissQuery('panel',['first-use','donation']),true);gate.resolve(null);await open;
 assert.equal(router.state.location.pathname,parent);assert.equal(router.state.location.search,'');await router.navigate(-1);assert.equal(router.state.location.pathname,'/');
});

test('direct query panel fallback preserves every unrelated field and ignores other query values',async t=>{
 const{router,controller}=fixture(t,{initialEntries:[{pathname:parent,search:'?music=midi&panel=first-use',hash:'#settings'}]});
 assert.equal(await controller.dismissQuery('panel',['first-use','donation']),true);
 assert.equal(router.state.location.pathname,parent);assert.equal(router.state.location.search,'?music=midi');assert.equal(router.state.location.hash,'#settings');
 await router.navigate(`${parent}?panel=unknown`);assert.equal(controller.dismissQuery('panel',['first-use','donation']),null);
});
