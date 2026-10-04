/** Bundle the actual React RuntimeHost keyboard binding for Node and real-Runtime
 * browser fixtures. No legacy launcher build or copied listener source is used. */
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
export async function bundleRuntimeKeyboard() {
  const result = await build({
    stdin: {contents: `export {bindRuntimeKeyboard} from './app/runtime/keyboard-binding.ts';
export {HostedKeyboard} from './src/launcher/hosted-keyboard.mts';
export {deliverRuntimeInput} from './src/launcher/touch-runtime-protocol.mts';`, resolveDir: root, loader: 'ts'},
    bundle: true, format: 'esm', platform: 'browser', write: false,
  });
  return result.outputFiles[0].text;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(await bundleRuntimeKeyboard());
}
