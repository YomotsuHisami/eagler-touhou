/** CI-only real HTTP fault fixture. No Playwright interception, production
 * server hook, global fault state, storage mutation, or module-byte rewriting. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createUiServer} from '../../scripts/serve-ui.mjs';

export function syntheticBootFailure(request) {
  if (!['GET','HEAD'].includes(request.method)) return null;
  const path=(request.url??'').split('?')[0];
  const match=/^\/assets\/(root|entry\.client)-[A-Za-z0-9_-]+\.js$/.exec(path);
  if (!match || request.headers['x-eagler-synthetic-boot-fault'] !== match[1]) return null;
  return {status:503,headers:{'Content-Type':'text/javascript','Cache-Control':'no-store','X-Eagler-Synthetic-Boot-Fault':'origin-503'},
    body:request.method==='HEAD'?'':'/* Synthetic temporary startup-module HTTP failure. */'};
}

export async function createBootRecoveryFixture(options) {
  const server=await createUiServer(options), [serve]=server.listeners('request');
  server.removeListener('request',serve);
  server.on('request',(request,response)=>{
    response.setHeader('X-Eagler-Boot-Fixture','origin');
    const failure=syntheticBootFailure(request);
    if(failure){response.writeHead(failure.status,failure.headers);response.end(failure.body);return;}
    return serve(request,response);
  });
  return server;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.env.EAGLER_UI_BOOT_FIXTURE!=='1')throw Error('Boot failure origin is an explicit test-only fixture');
  const server=await createBootRecoveryFixture();
  server.listen(4176,'127.0.0.1',()=>console.log('Synthetic boot-failure origin: http://127.0.0.1:4176/'));
}
