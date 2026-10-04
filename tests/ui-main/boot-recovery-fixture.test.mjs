/** Deterministic synthetic fault transition; no browser/network is started. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSyntheticBootModuleFailure} from './synthetic-boot-module-failure.ts';

test('temporary module fixture fails repeat requests without caching and uses the same handler to recover',async()=>{
  const fault=createSyntheticBootModuleFailure(), calls=[];
  const route={fulfill:async options=>{calls.push(options);},continue:async()=>{calls.push('network');}};
  await fault.handle(route);await fault.handle(route);
  assert.equal(calls.length,2);
  for(const response of calls){assert.equal(response.status,503);assert.deepEqual(response.headers,{'cache-control':'no-store'});assert.equal(response.contentType,'text/javascript');assert.match(response.body,/Synthetic/);}
  fault.recover();await fault.handle(route);fault.recover();await fault.handle(route);
  assert.deepEqual(calls.slice(2),['network','network']);
});

test('independent missing-module scenarios cannot share a recovered fault state',async()=>{
  const first=createSyntheticBootModuleFailure(), second=createSyntheticBootModuleFailure();first.recover();
  let status=null;await second.handle({fulfill:async response=>{status=response.status;},continue:async()=>{throw Error('Another test must not recover this fault');}});
  assert.equal(status,503);
});
