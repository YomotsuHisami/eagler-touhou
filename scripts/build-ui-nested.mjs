import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['scripts/build-ui-main.mjs'],{stdio:'inherit',env:{...process.env,EAGLER_UI_MOUNT_PATH:'/nested-launcher/',EAGLER_UI_BUILD_DIRECTORY:'.cache/build/ui-main-nested'}});
if(result.error)throw result.error;
process.exitCode=result.status??1;
