/** Portable two-scenario native acceptance. Imports are inert; tests inject the
 * process runner. Forward publication/user arguments to both Python invocations. */
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const project=fileURLToPath(new URL('../',import.meta.url));
const entry='tests/test-th09mp-launch.py';
export function runTh09LaunchBrowser({args=process.argv.slice(2),environment=process.env,run=spawnSync}={}){
 if(args[0]!==entry)throw Error(`Usage: node scripts/test-th09mp-launch-browser.mjs ${entry} [--url=LOOPBACK_MOUNT] [native test options]`);
 for(const scenario of [['--host-entry=title','--touch-check'],['--host-entry=card','--music=none']]){
  const result=run(environment.PYTHON||'python',[entry,...args.slice(1),...scenario],{cwd:project,env:environment,stdio:'inherit',shell:false});
  if(result.error)throw result.error;
  if(result.status!==0)return result.status??1;
 }
 return 0;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=runTh09LaunchBrowser();
