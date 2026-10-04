import test from 'node:test';import assert from 'node:assert/strict';
import {createNavigationDraftRegistry,requiresUnloadConfirmation} from '../../app/services/navigation-drafts.ts';
test('only active owning draft can participate in a blocked navigation',()=>{
 const r=createNavigationDraftRegistry();let dirty=true;const d={id:'touch',label:'触控布局',shouldBlock:(a,b)=>dirty&&a.search!==b.search,save(){dirty=false;},discard(){dirty=false;}};
 const remove=r.register(d);assert.throws(()=>r.register(d),/Duplicate/);assert.deepEqual(r.blocking({search:'?touchLayout=1'},{search:''}),[d]);assert.equal(r.owns(d),true);d.save();assert.deepEqual(r.blocking({search:'?touchLayout=1'},{search:''}),[]);remove();assert.equal(r.owns(d),false);
});
test('stale unregister cannot remove a replacement owner',()=>{
 const r=createNavigationDraftRegistry(),first={id:'x',label:'x',shouldBlock:()=>true,save(){},discard(){}};const remove=r.register(first);remove();const second={...first};r.register(second);remove();assert.equal(r.owns(second),true);
});

test('document leave protects Runtime saves and independent drafts without duplicate ownership',()=>{
 assert.equal(requiresUnloadConfirmation(null,0),false);assert.equal(requiresUnloadConfirmation(null,1),true);
 assert.equal(requiresUnloadConfirmation({ready:true,saveError:null},0),true);assert.equal(requiresUnloadConfirmation({ready:false,saveError:'lost'},0),true);
 assert.equal(requiresUnloadConfirmation({ready:false,saveError:null},0),false);
});
