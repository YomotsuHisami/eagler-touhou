import assert from 'node:assert/strict';
import {createFunctionKeyOwner,functionKeySpec,functionKeyGames} from '../.cache/build/browser/assets/launcher/touch-function-key.mjs';
const events=[];let pending=null;
const fire=()=>{const fn=pending;pending=null;fn();};
const key=createFunctionKeyOwner(down=>events.push(down),'tap',fn=>(pending=fn),()=>{pending=null;});
assert.deepEqual(functionKeySpec,{code:'KeyC',key:'c',keyCode:67});
assert.ok(functionKeyGames.has('th11'));assert.ok(!functionKeyGames.has('th10'));
assert.equal(key.down(1),true);assert.equal(key.down(2),false);
key.lost(2);assert.deepEqual(events,[true],'unowned pointer cancellation is isolated');
fire();assert.deepEqual(events,[true,false],'long hold produces only one tap');
fire();assert.equal(pending,null,'pulse gap ends without repeating a held press');
key.up(2);assert.equal(key.down(3),false,'another finger cannot take the held button');
key.up(1);key.down(3);key.up(3);key.lost(3);
assert.deepEqual(events,[true,false,true],'normal capture release preserves the short pulse');
fire();fire();key.down(4);key.cancel();assert.equal(pending,null);
assert.deepEqual(events,[true,false,true,false,true,false],'background/cancel releases immediately');

events.length=0;
key.down(1);key.up(1);key.down(2);key.up(2);
assert.deepEqual(events,[true],'rapid second tap waits for the first pulse');
fire();assert.deepEqual(events,[true,false],'first pulse releases before another DOWN');
fire();assert.deepEqual(events,[true,false,true],'second pulse starts after a sampled UP gap');
fire();fire();assert.deepEqual(events,[true,false,true,false]);

events.length=0;
key.down(1);key.up(1);key.down(2);key.up(2);key.cancel();
assert.equal(pending,null,'lifecycle cancellation discards queued taps');
assert.deepEqual(events,[true,false]);
key.down(3);key.up(3);fire();key.cancel();
assert.equal(pending,null,'cancellation during the UP gap retires its timer');
assert.deepEqual(events,[true,false,true,false]);

// Verify logical-frame observations, not just emitted browser event ordering.
let clock=0,held=false,lastSample=false,pressedEdges=0;
const timers=new Map();let serial=0;
const sampled=createFunctionKeyOwner(down=>{held=down;},'tap',fn=>{
  const id=++serial;timers.set(id,{at:clock+50,fn});return id;
},id=>timers.delete(id));
function advance(to) {
  while(true) {
    const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];
    if(!next || next[1].at>to) break;
    clock=next[1].at;timers.delete(next[0]);next[1].fn();
  }
  clock=to;
}
sampled.down(1);sampled.up(1);advance(10);sampled.down(2);sampled.up(2);
for(let frame=1;frame<=15;frame++) {
  advance(frame*1000/60);
  if(held&&!lastSample) pressedEdges++;
  lastSample=held;
}
assert.equal(pressedEdges,2,'60 Hz sampling observes both rapid taps as separate presses');
assert.equal(timers.size,0,'completed taps leave no timer');
console.log('C tap, multi-pointer isolation, capture release and cancellation passed');
