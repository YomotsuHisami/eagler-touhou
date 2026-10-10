import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/** Native erasable TypeScript is limited to this optional maintainer lane.
 * Original main/self-host commands keep their existing Node engine contract. */
export function assertUiRewriteRuntime(version = process.versions.node) {
  const match = /^(\d+)\.(\d+)\.\d+(?:-|$)/.exec(version);
  const major = Number(match?.[1]), minor = Number(match?.[2]);
  if (!(major >= 24 || major === 23 && minor >= 6 || major === 22 && minor >= 18)) {
    throw new Error(`The React rewrite test/fixture lane requires Node.js 22.18+, 23.6+, or 24+; found ${version}. Only Node.js 24.19 has been verified for this lane.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) assertUiRewriteRuntime();
