import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { resolve, dirname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublishedSiteServer, safeSiteFile } from '../server/ui-static-server.mjs';
import { assertSafeDevelopmentServerScope } from '../lib/development-server-scope.mjs';

const project = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Source preview uses the verified React artifact without publishing a worker.
 * Assembled/legacy directory serving never imports the frontend toolchain. */
export async function createDevelopmentServer({ root = resolve(project, '..'), host = '127.0.0.1', environment = process.env } = {}) {
  root = resolve(root);
  assertSafeDevelopmentServerScope({ host, project, root });
  const sourceDevelopmentServer = root === project || root === resolve(project, '..');
  let navigation = null, resolveResource = null, configuredArtworkDirectory = null;
  if (sourceDevelopmentServer) {
    const [{ FRONTEND_PACKAGE_FILES, FRONTEND_UI_ARTIFACT, hostArtworkFiles, resolveFrontendPackageSource },
      { createDevelopmentHostManifest }, { DEVELOPMENT_CONTENT }, { privateFrontendAssetSource }, { workspaceRoot },
      { HOST_MANIFEST_FILE }, { RELEASE_CATALOG_FILE, RELEASE_CATALOG_SCHEMA }] = await Promise.all([
      import('../lib/frontend-manifest.mjs'), import('../lib/development-host-manifest.mjs'), import('../lib/development-content.mjs'),
      import('../lib/private-frontend-assets.mjs'), import('../lib/workspace-layout.mjs'),
      import('../lib/contracts/host-manifest.mjs'), import('../lib/contracts/release-catalog.mjs'),
    ]);
    navigation = FRONTEND_UI_ARTIFACT.navigation;
    const defaultArtwork = resolve(workspaceRoot(), 'games', 'host-artwork');
    configuredArtworkDirectory = environment.EAGLER_TOUHOU_ARTWORK_DIR || (existsSync(defaultArtwork) ? defaultArtwork : null);
    if (configuredArtworkDirectory) configuredArtworkDirectory = await realpath(resolve(configuredArtworkDirectory));
    const hostArtwork = new Set(hostArtworkFiles(Object.keys(DEVELOPMENT_CONTENT.games)));
    const metadata = new Map([
      [HOST_MANIFEST_FILE, JSON.stringify(await createDevelopmentHostManifest({
        netplayRelay: environment.EAGLER_TOUHOU_NETPLAY_RELAY?.trim() || undefined,
        games: environment.EAGLER_DEVELOPMENT_GAMES?.split(',').map(value => value.trim()).filter(Boolean),
      }), null, 2) + '\n'],
      [RELEASE_CATALOG_FILE, JSON.stringify({ schema: RELEASE_CATALOG_SCHEMA, games: {} }, null, 2) + '\n'],
    ]);
    const frontend = new Set(FRONTEND_PACKAGE_FILES);
    const roots = [...new Set([resolve(project, 'public'), project, root])];
    const sourceRoots = await Promise.all(roots.map(value => realpath(value)));
    const artifactRoot = await realpath(FRONTEND_UI_ARTIFACT.root);
    resolveResource = async pathname => {
      const name = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (metadata.has(name)) return { body: metadata.get(name), contentType: 'application/json; charset=utf-8' };
      const privateAsset = privateFrontendAssetSource(name);
      if (privateAsset && existsSync(privateAsset)) return safeSiteFile(await realpath(dirname(privateAsset)), '/' + basename(privateAsset));
      const artworkName = name.startsWith('assets/') ? name.slice('assets/'.length) : '';
      if (configuredArtworkDirectory && hostArtwork.has(artworkName)) {
        const file = await safeSiteFile(configuredArtworkDirectory, '/' + artworkName);
        if (file) return file;
      }
      if (frontend.has(name)) {
        const source = resolveFrontendPackageSource(name);
        // Explicit frontend manifest entries may come from prebuilt or public
        // sources. Resolve their symlinks under those owners, never the workspace.
        for (const owner of [artifactRoot, ...sourceRoots]) {
          const relative = source.slice(owner.length).replaceAll('\\', '/');
          if (source.startsWith(owner + sep)) {
            const file = await safeSiteFile(owner, relative);
            if (file) return file;
          }
        }
        return null;
      }
      for (const sourceRoot of sourceRoots) {
        const file = await safeSiteFile(sourceRoot, pathname);
        if (file) return file;
      }
      return null;
    };
  }
  let middleware = null, runtimeCompiler = null;
  const thcrapEnabled = environment.EAGLER_ENABLE_THCRAP === '1';
  if (thcrapEnabled) {
    const [{ createThcrapHttpHandler }, { ThcrapRuntimeCompiler }, { ThtkRunner }, { PRODUCT_CONTENT }] = await Promise.all([
      import('../server/thcrap-service.mjs'), import('../server/thcrap-compiler.mjs'), import('../server/thtk-runner.mjs'), import('../lib/content-definition.mjs'),
    ]);
    const bundledThtk = resolve(root, 'dependencies', 'thtk-bin-12', 'thtk-bin-12');
    const thdat = resolve(environment.EAGLER_THTK_THDAT || resolve(bundledThtk, 'thdat.exe'));
    const thmsg = resolve(environment.EAGLER_THTK_THMSG || resolve(bundledThtk, 'thmsg.exe'));
    const archives = Object.fromEntries(Object.entries(PRODUCT_CONTENT)
      .filter(([, content]) => content.hostPreparation?.languagePack?.kind === 'thcrap-runtime-compiler')
      .map(([game, content]) => {
        const preparation = content.hostPreparation.languagePack;
        const configured = environment[preparation.developmentEnv];
        const paths = configured ? configured.split(';').map(value => value.trim()).filter(Boolean).map(value => resolve(value))
          : (preparation.developmentFiles || []).map(name => resolve(root, 'games', game, name)).filter(value => existsSync(value));
        return [game, paths];
      }));
    if (existsSync(thdat) && existsSync(thmsg) && Object.values(archives).every(paths => paths.length)) {
      runtimeCompiler = new ThcrapRuntimeCompiler({ runner: new ThtkRunner({ thdat, thmsg }), archives });
    }
    middleware = createThcrapHttpHandler({ repository: environment.EAGLER_THCRAP_REPOSITORY, cacheRoot: environment.EAGLER_THCRAP_CACHE,
      maxAgeMs: Number.parseInt(environment.EAGLER_THCRAP_MAX_AGE_MS || '900000', 10),
      ...(runtimeCompiler ? { packProcessor: resources => runtimeCompiler.processPack(resources) } : {}),
    });
  }
  const server = await createPublishedSiteServer({ root: sourceDevelopmentServer ? project : root,
    publication: !sourceDevelopmentServer, navigation, resolveResource, middleware,
    onError: (error, request) => console.warn(`HTTP ${request.url}: ${error instanceof Error ? error.message : String(error)}`),
  });
  server.development = { artwork: configuredArtworkDirectory, thcrapEnabled, runtimeCompiler: !!runtimeCompiler };
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.EAGLER_TOUHOU_HOST || '127.0.0.1';
  const port = Number(process.argv[2] || process.env.EAGLER_TOUHOU_PORT || '8130');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  const server = await createDevelopmentServer({ host, root: process.argv[3] || resolve(project, '..') });
  server.listen(port, host, () => {
    console.log(`eagler-touhou: http://${host}:${port}${server.uiMountPath}`);
    console.log(`host artwork: ${server.development.artwork || 'not configured'}`);
    console.log(`thcrap: ${server.development.thcrapEnabled ? (server.development.runtimeCompiler ? 'enabled' : 'enabled without runtime compiler') : 'disabled'}`);
  });
}
