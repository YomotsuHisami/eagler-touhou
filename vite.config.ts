import {defineConfig} from 'vite';
import {reactRouter} from '@react-router/dev/vite';
import {originalBootstrap} from './scripts/ui-rewrite/original-bootstrap.ts';
import {mainAssets} from './scripts/ui-rewrite/main-assets.ts';
import {authoredSources} from './scripts/ui-rewrite/authored-sources.ts';
import {reactDeploymentConfig} from './scripts/ui-rewrite/deployment-config.ts';
const deployment = reactDeploymentConfig();
export default defineConfig({base: deployment.mountPath,
  build: {manifest: true},
  define: {__REACT_APP_SHELL_DEPLOYMENT__: JSON.stringify(deployment.appShell)},
  plugins: [originalBootstrap(), mainAssets(), authoredSources(), reactRouter()], publicDir: false});
