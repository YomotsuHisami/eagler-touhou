import {build} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {browserContractSources} from './vite-contracts.ts';
import {resolve} from 'node:path';
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
const output=resolve('.cache/ui-main-harness');
const fixtures=['runtime-controls','dialog-motion','runtime-history','runtime-history-peer','runtime-viewport','player-tools','request-resume','title-room-entry','room-panels','multiplayer-preflight','multiplayer-preflight-peer','replay-manager','lobby-directory'];
await build({configFile:false,root:resolve('tests/ui-main'),publicDir:false,
 plugins:[browserContractSources(),tailwindcss()],oxc:{jsx:{runtime:'automatic'}},
 build:{outDir:output,emptyOutDir:true,rolldownOptions:{input:fixtures.map(name=>resolve(`tests/ui-main/${name}.html`))}}});
await mkdir(resolve(output,'__ui_tests__'),{recursive:true});
for(const name of fixtures) await copyFile(resolve(output,`${name}.html`),resolve(output,`__ui_tests__/${name}.html`));
await copyFile(resolve(output,'runtime-controls.html'),resolve(output,'index.html'));
await writeFile(resolve(output,'ui-navigation.json'),JSON.stringify({schema:'eagler-touhou/ui-navigation/1',patterns:['/','/play/:productId','/play/:productId/resources','/play/:productId/replays','/play/:productId/saves']}));
console.log('Synthetic controls fixture built separately; never included in the UI deployment output');
