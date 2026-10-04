import {build} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {browserContractSources} from './vite-contracts.ts';
import {resolve} from 'node:path';
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
const output=resolve('.cache/ui-main-harness');
await build({configFile:false,root:resolve('tests/ui-main'),publicDir:false,
 plugins:[browserContractSources(),tailwindcss()],oxc:{jsx:{runtime:'automatic'}},
 build:{outDir:output,emptyOutDir:true,rolldownOptions:{input:resolve('tests/ui-main/runtime-controls.html')}}});
await mkdir(resolve(output,'__ui_tests__'),{recursive:true});
await copyFile(resolve(output,'runtime-controls.html'),resolve(output,'__ui_tests__/runtime-controls.html'));
await copyFile(resolve(output,'runtime-controls.html'),resolve(output,'index.html'));
await writeFile(resolve(output,'ui-navigation.json'),JSON.stringify({schema:'eagler-touhou/ui-navigation/1',patterns:['/','/games/:productId']}));
console.log('Synthetic controls fixture built separately; never included in the UI deployment output');
