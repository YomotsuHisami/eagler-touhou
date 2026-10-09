import test from 'node:test';
import assert from 'node:assert/strict';
import {productManagementRoute,leavesProductManagement,productManagementSearch,playerIntentScope,leavesPlayerHistory} from '../../app/runtime/route-session.mts';
test('resource and replay routes retain only their own product session',()=>{
 for(const a of ['/play/th06','/play/th06/resources','/play/th06/replays','/play/th06/saves']) for(const b of ['/play/th06','/play/th06/resources','/play/th06/replays','/play/th06/saves']) assert.equal(leavesProductManagement(a,b),false);
 for(const target of ['/','/play/th07','/play/th06mp','/play/th06/unknown','/play/th20']) assert.equal(leavesProductManagement('/play/th06/replays',target),true);
});
test('unknown and malformed routes never acquire product ownership; test builds retain TH20 history',()=>{
 for(const value of ['/play/unknown','/play/th06/resources/extra','/play/th06//replays','/play/%74h06']) assert.equal(productManagementRoute(value),null);
 assert.equal(productManagementRoute('/play/th20'), 'th20');
 assert.equal(productManagementRoute('/play/th11/resources'),'th11');
 assert.equal(leavesProductManagement('/','/'),false);
});

test('main Player history layer retains Start scope and Back retires Player before its product/room',()=>{
 const origin={key:'options',pathname:'/play/th06mp',search:'?mpRoom=1234',hash:'#kept',state:null};
 const player={...origin,key:'player',state:{uiPlayer:{productId:'th06mp',originKey:'options',active:true}}};
 assert.equal(playerIntentScope(player),playerIntentScope(origin));
 assert.equal(leavesPlayerHistory(player,origin,'POP'),true);assert.equal(leavesPlayerHistory(player,origin,'PUSH'),false);
 assert.equal(leavesPlayerHistory({...player,state:{uiPlayer:{productId:'th07mp',originKey:'options',active:true}}},origin,'POP'),false);
 assert.notEqual(playerIntentScope({...player,search:'?mpRoom=5678'}),playerIntentScope(origin));
});

test('child navigation retains room and locale but closes transient overlays',()=>{
 assert.equal(productManagementSearch('?mpRoom=1234&room=1234&uiLocale=en&panel=help&touchLayout=1&lobbyDialog=join&roomPanel=personal'),'?mpRoom=1234&room=1234&uiLocale=en');
 assert.equal(productManagementSearch('?touchLayout=1'),'');
});
