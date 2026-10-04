import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPublicationFixtureServers} from './fixture-servers.mjs';

test('CI publication endpoints isolate preview and both mounts without browser security overrides',async()=>{
 const {previewFixture,publicationFixtures}=await import('./fixture-addresses.ts');
 assert.equal(previewFixture.origin,'http://127.0.0.1:4178');
 const addresses=[previewFixture,...publicationFixtures,...publicationFixtures.map(({controlPort:port,controlOrigin:origin})=>({port,origin}))];
 assert.equal(new Set(addresses.map(item=>item.origin)).size,5);
 for(const {port,origin} of addresses){const url=new URL(origin);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.protocol,'http:');assert.equal(Number(url.port),port);assert.notEqual(port,4190,'CI Firefox/WebKit restricted-port evidence must not be bypassed with browser preferences');}
 assert.deepEqual(publicationFixtures.map(({mount})=>mount),['/','/nested-launcher/']);
});

function fixtureServerHarness() {
 const created=[],calls=[];
 class FakeServer extends EventEmitter {
  listening=false;
  constructor(handler){super();this.on('request',handler);created.push(this);}
  listen(port,host,done){calls.push(['listen',port,host]);this.listening=true;queueMicrotask(done);return this;}
  close(done){calls.push(['close',this]);this.listening=false;this.completeClose=done;}
  closeAllConnections(){calls.push(['closeAllConnections',this]);if(!this.holdClose)queueMicrotask(()=>this.completeClose());}
 }
 const variants=['a','b'].map(version=>({emit(type,request,response){calls.push(['serve',version,request.url]);response.writeHead(200).end(version);}}));
 const servers=createPublicationFixtureServers({variants,port:4191,controlPort:4193,createServer:handler=>new FakeServer(handler)});
 const request=(server,url,method='GET')=>new Promise(resolve=>{
  const response={writeHead(status,headers){this.status=status;this.headers=headers;return this;},end(body){resolve({status:this.status,headers:this.headers,body});}};
  server.emit('request',{url,method},response);
 });
 return {servers,created,calls,request};
}

test('CI publication fixture keeps outage control isolated and both listeners loopback-only',async()=>{
 const {servers,created,calls,request}=fixtureServerHarness();
 await servers.start();
 assert.equal(created.length,2);
 assert.deepEqual(calls.filter(([action])=>action==='listen'),[['listen',4193,'127.0.0.1'],['listen',4191,'127.0.0.1']]);
 assert.equal((await request(servers.publication,'/__ci_publication__/select?version=b','POST')).body,'a','public origin has no test control handler');
 assert.equal((await request(servers.control,'/__ci_publication__/select?version=b','POST')).status,200);
 assert.equal((await request(servers.publication,'/')).body,'b');
 const status=await request(servers.control,'/__ci_publication__/status');
 assert.deepEqual(JSON.parse(status.body),{version:'b',publicationListening:true,port:4191,controlPort:4193});
 assert.equal(status.headers['Cache-Control'],'no-store');
 await servers.close();
});

test('CI publication outage acknowledgement waits for closure and drops existing connections',async()=>{
 const {servers,calls,request}=fixtureServerHarness();await servers.start();
 servers.publication.holdClose=true;
 let acknowledged=false;
 const outage=request(servers.control,'/__ci_publication__/availability?state=unavailable','POST').then(value=>{acknowledged=true;return value;});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(acknowledged,false);
 assert.deepEqual(calls.slice(-2),[['close',servers.publication],['closeAllConnections',servers.publication]]);
 servers.publication.completeClose();
 assert.equal(JSON.parse((await outage).body).publicationListening,false);
 assert.equal(servers.control.listening,true,'independent control survives public outage');
 servers.publication.holdClose=false;
 const recovery=await request(servers.control,'/__ci_publication__/availability?state=online','POST');
 assert.equal(JSON.parse(recovery.body).publicationListening,true);
 assert.equal((await request(servers.publication,'/')).body,'a','restart does not silently select a new publication');
 await servers.close();
});

test('CI publication fixture serializes outage/recovery and rejects malformed control actions',async()=>{
 const {servers,calls,request}=fixtureServerHarness();await servers.start();
 await Promise.all([servers.setAvailable(false),servers.setAvailable(true),servers.setAvailable(true)]);
 assert.equal(servers.status().publicationListening,true);
 assert.equal(calls.filter(([action,port])=>action==='listen'&&port===4191).length,2);
 for(const [url,method] of [['/__ci_publication__/availability?state=unknown','POST'],['/__ci_publication__/availability?state=unavailable','GET'],['/__ci_publication__/select?version=c','POST'],['/','GET']])assert.equal((await request(servers.control,url,method)).status,400);
 assert.equal(servers.status().publicationListening,true);
 await servers.close();
});

test('CI publication fixture rejects overlapping ports before constructing a server',()=>{
 assert.throws(()=>createPublicationFixtureServers({variants:[{},{}],port:4191,controlPort:4191,createServer:()=>{throw Error('must not construct');}}),/Separate fixture ports/);
});
