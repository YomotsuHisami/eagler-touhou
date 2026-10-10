import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {frontendSelection} from '../../lib/react-frontend-artifact.mjs';
import {assertSafeDevelopmentServerScope} from '../../lib/development-server-scope.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));

/** Call only after the original verify-server-build step accepts this output.
 * Select the server command, never copy files or rewrite publication metadata.
 * Main retains its exact original command and source-server behavior. */
export function webkitPublicationServerArguments(output, port, environment = process.env) {
  const original = ['scripts/serve.mjs', String(port), output];
  if (frontendSelection(environment) !== 'react') return original;
  if (resolve(output) === resolve(project)) throw new Error('WebKit publication must be the verified packaged output, not the source project');
  const host = environment.EAGLER_TOUHOU_HOST || '127.0.0.1';
  assertSafeDevelopmentServerScope({host, project, root: output});
  if (environment.EAGLER_ENABLE_THCRAP === '1' || environment.EAGLER_TOUHOU_ARTWORK_DIR) {
    throw new Error('WebKit React publication serving requires packaged resources; dynamic thcrap/artwork overrides are unsupported');
  }
  const deployment = JSON.parse(readFileSync(resolve(output, 'deployment.json'), 'utf8'));
  if (deployment.format !== 'eagler-touhou-deployment/1' || deployment.frontend?.kind !== 'react' ||
      deployment.frontend.mountPath !== '/' || deployment.appShell !== null) {
    throw new Error('WebKit root URL requires the verified root-mounted React publication without an isolated App Shell');
  }
  return ['scripts/serve-static.mjs', output, String(port)];
}
