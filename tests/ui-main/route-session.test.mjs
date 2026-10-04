import test from 'node:test';
import assert from 'node:assert/strict';
import {productManagementRoute,leavesProductManagement,productManagementSearch} from '../../app/runtime/route-session.mts';
test('resource and replay routes retain only their own product session',()=>{
 for(const a of ['/play/th06','/play/th06/resources','/play/th06/replays','/play/th06/saves']) for(const b of ['/play/th06','/play/th06/resources','/play/th06/replays','/play/th06/saves']) assert.equal(leavesProductManagement(a,b),false);
 for(const target of ['/','/play/th07','/play/th06mp','/play/th06/unknown','/play/th20']) assert.equal(leavesProductManagement('/play/th06/replays',target),true);
});
test('unknown, hidden and malformed routes never acquire product ownership',()=>{
 for(const value of ['/play/th20','/play/unknown','/play/th06/resources/extra','/play/th06//replays','/play/%74h06']) assert.equal(productManagementRoute(value),null);
 assert.equal(productManagementRoute('/play/th11/resources'),'th11');
 assert.equal(leavesProductManagement('/','/'),false);
});

test('child navigation retains room and locale but closes transient overlays',()=>{
 assert.equal(productManagementSearch('?mpRoom=1234&room=1234&uiLocale=en&panel=help&touchLayout=1&lobbyDialog=join'),'?mpRoom=1234&room=1234&uiLocale=en');
 assert.equal(productManagementSearch('?touchLayout=1'),'');
});
