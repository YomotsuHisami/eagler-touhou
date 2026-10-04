import {build} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {browserContractSources} from './vite-contracts.ts';
import {resolve} from 'node:path';
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
const output=resolve('.cache/ui-main-harness');
await build({configFile:false,root:resolve('tests/ui-main'),publicDir:false,
 plugins:[browserContractSources(),tailwindcss()],oxc:{jsx:{runtime:'automatic'}},
 build:{outDir:output,emptyOutDir:true,rolldownOptions:{input:['runtime-controls','dialog-motion'].map(name=>resolve(`tests/ui-main/${name}.html`))}}});
await mkdir(resolve(output,'__ui_tests__'),{recursive:true});
for(const name of ['runtime-controls','dialog-motion']) await copyFile(resolve(output,`${name}.html`),resolve(output,`__ui_tests__/${name}.html`));
await copyFile(resolve(output,'runtime-controls.html'),resolve(output,'index.html'));
await writeFile(resolve(output,'ui-navigation.json'),JSON.stringify({schema:'eagler-touhou/ui-navigation/1',patterns:['/','/games/:productId']}));
console.log('Synthetic controls fixture built separately; never included in the UI deployment output');
