/** Deterministic synthetic fault transition; no browser/network is started. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {syntheticBootFailure} from '../browser/boot-recovery-fixture.mjs';

test('real HTTP module fixture returns no-store 503 only for the exact per-request fault and same hashed module path',()=>{
  for(const chunk of ['root','entry.client']){
    const request={method:'GET',url:`/assets/${chunk}-abcdefgh.js`,headers:{'x-eagler-synthetic-boot-fault':chunk}};
    const response=syntheticBootFailure(request);assert.equal(response.status,503);assert.equal(response.headers['Cache-Control'],'no-store');assert.equal(response.headers['X-Eagler-Synthetic-Boot-Fault'],'origin-503');assert.match(response.body,/Synthetic/);
    assert.equal(syntheticBootFailure({...request,headers:{}}),null,'removing the request fault header restores the actual unchanged artifact');
    assert.equal(syntheticBootFailure({...request,method:'HEAD'}).body,'');
  }
});

test('real HTTP fault cannot affect other modules, navigations, paths, or request methods',()=>{
  for(const url of ['/','/?uiLocale=en','/assets/other-abcdefgh.js','/other/assets/root-abcdefgh.js','/assets/root.js','/runtime/root-abcdefgh.js','/assets/root-abcdefgh.js/../root.js'])assert.equal(syntheticBootFailure({method:'GET',url,headers:{'x-eagler-synthetic-boot-fault':'root'}}),null,url);
  assert.equal(syntheticBootFailure({method:'POST',url:'/assets/root-abcdefgh.js',headers:{'x-eagler-synthetic-boot-fault':'root'}}),null);
  assert.equal(syntheticBootFailure({method:'GET',url:'/assets/root-abcdefgh.js',headers:{'x-eagler-synthetic-boot-fault':'entry.client'}}),null);
});
