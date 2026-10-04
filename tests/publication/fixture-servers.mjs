import {createServer as createHttpServer} from 'node:http';

/** CI-only outage control. The publication listener really closes; a separate
 * loopback control listener can restart it without browser interception. The
 * server factory is injected in source tests so they never bind a socket. */
export function createPublicationFixtureServers({variants,port,controlPort,createServer=createHttpServer}) {
 if(!Array.isArray(variants)||variants.length!==2)throw Error('Two publication variants are required');
 if(![port,controlPort].every(value=>Number.isInteger(value)&&value>1024&&value<=65535)||port===controlPort)throw Error('Separate fixture ports are required');
 let selected=0,transition=Promise.resolve();
 const publication=createServer((request,response)=>variants[selected].emit('request',request,response));
 const status=()=>({version:selected?'b':'a',publicationListening:publication.listening,port,controlPort});
 const listen=(server,value)=>new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(value,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});
 });
 const close=server=>new Promise((resolve,reject)=>{
  if(!server.listening){resolve();return;}
  server.close(error=>error?reject(error):resolve());
  // Existing keep-alive sockets must not serve bytes after the outage ack.
  server.closeAllConnections();
 });
 function setAvailable(online) {
  const task=transition.then(async()=>{
   if(online&&!publication.listening)await listen(publication,port);
   if(!online)await close(publication);
   return status();
  });
  transition=task.catch(()=>{});
  return task;
 }
 const control=createServer((request,response)=>{
  void (async()=>{
   const url=new URL(request.url,'http://127.0.0.1:'+controlPort);
   let result;
   if(url.pathname==='/__ci_publication__/status'&&request.method==='GET')result=status();
   else if(url.pathname==='/__ci_publication__/select'&&request.method==='POST'&&['a','b'].includes(url.searchParams.get('version'))){
    selected=url.searchParams.get('version')==='b'?1:0;result=status();
   } else if(url.pathname==='/__ci_publication__/availability'&&request.method==='POST'&&['online','unavailable'].includes(url.searchParams.get('state'))){
    result=await setAvailable(url.searchParams.get('state')==='online');
   } else {response.writeHead(400,{'Cache-Control':'no-store'}).end();return;}
   response.writeHead(200,{'Cache-Control':'no-store','Content-Type':'application/json'}).end(JSON.stringify(result));
  })().catch(()=>response.writeHead(500,{'Cache-Control':'no-store'}).end('Fixture control failed'));
 });
 return {publication,control,status,setAvailable,
  async start(){await listen(control,controlPort);try{await setAvailable(true);}catch(error){await close(control);throw error;}},
  async close(){await setAvailable(false);await close(control);},
 };
}
