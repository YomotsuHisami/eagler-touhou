import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createUiServer} from '../../scripts/serve-ui.mjs';
if(process.env.EAGLER_UI_PUBLICATION_FIXTURE!=='1')throw Error('This is an explicit synthetic CI fixture server only');
const name=process.argv[2],port=Number(process.argv[3]);
if(!['root','nested'].includes(name)||![4191,4192].includes(port))throw Error('Use root 4191 or nested 4192 fixture');
const root=resolve('.cache/ui-publication-browser'),proof=JSON.parse(await readFile(resolve(root,'fixture.json'),'utf8'));
if(proof.syntheticOnly!==true)throw Error('Synthetic fixture marker missing');
const variants=await Promise.all(['a','b'].map(version=>createUiServer({root:resolve(root,`${name}-${version}`)})));
let selected=0;
createServer((request,response)=>{
 const url=new URL(request.url,'http://127.0.0.1:'+port);
 if(url.pathname==='/__ci_publication__/select'){
  if(request.method!=='POST'||!['a','b'].includes(url.searchParams.get('version'))){response.writeHead(400).end();return;}
  selected=url.searchParams.get('version')==='b'?1:0;response.writeHead(204,{'Cache-Control':'no-store'}).end();return;
 }
 variants[selected].emit('request',request,response);
}).listen(port,'127.0.0.1',()=>console.log(`Synthetic ${name} publication fixture on ${port}`));
