import type {Config} from '@react-router/dev/config';
import {resolve} from 'node:path';
import {finalizeOriginalEntrypoints} from './scripts/ui-rewrite/static-entrypoints.ts';
import {reactDeploymentConfig} from './scripts/ui-rewrite/deployment-config.ts';
import {buildReactAppShell, writeReactAppShellGraph} from './scripts/ui-rewrite/app-shell-build.ts';
const deployment = reactDeploymentConfig();
/** Build-time HTML only; no rendering server or deployment is introduced. */
export default {
  ssr: false,
  basename: deployment.mountPath,
  buildDirectory: deployment.outputDirectory,
  prerender: ['/en.html', '/lobby.html'],
  async buildEnd({reactRouterConfig}) {
    const clientDirectory = resolve(reactRouterConfig.buildDirectory, 'client');
    await finalizeOriginalEntrypoints(clientDirectory, deployment.mountPath);
    await writeReactAppShellGraph({clientDirectory, mountPath: deployment.mountPath, appShell: deployment.appShell});
    await buildReactAppShell({clientDirectory, ...deployment});
  },
} satisfies Config;
