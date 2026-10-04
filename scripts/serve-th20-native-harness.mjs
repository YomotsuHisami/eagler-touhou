/** Explicit loopback-only test mount. Never copies/stages Package or Runtime bytes. */
import {resolve} from 'node:path';
import {readFile, realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createPublishedSiteServer, safeSiteFile} from '../server/ui-static-server.mjs';

/** Paths have already been decoded and stripped of the publication mount by
 * the portable server. The fixture cannot shadow ordinary publication assets. */
export function nativeFixtureResourceResolver(publicationRoot, fixtureRoot) {
  return pathname => {
    if (['/ui-ownership.json', '/ui-artifact.json'].includes(pathname)) return null;
    if (pathname === '/__th20_native__' || pathname.startsWith('/__th20_native__/')) {
      if (['/__th20_native__/ui-ownership.json', '/__th20_native__/ui-artifact.json'].includes(pathname)) return null;
      return safeSiteFile(fixtureRoot, pathname);
    }
    return safeSiteFile(publicationRoot, pathname);
  };
}

/** Construct only; callers decide whether to bind the loopback listener. Uses
 * the published marker/navigation contract, never private build ownership. */
export async function createTh20NativeHarnessServer({publicationRoot, fixtureRoot = resolve('.cache/th20-native-harness')} = {}) {
  if (!publicationRoot) throw new Error('Supply an explicit already-assembled publication directory');
  const root = await realpath(resolve(publicationRoot)), fixtures = await realpath(resolve(fixtureRoot));
  const markerFile = await safeSiteFile(root, '/ui-publication.json');
  if (!markerFile || markerFile.directory) throw new Error('An assembled React publication is required');
  const marker = JSON.parse(await readFile(markerFile.path, 'utf8'));
  if (marker.schema !== 'eagler-touhou/ui-publication/1' || !['react-main', 'experimental-opt-in'].includes(marker.status)) throw new Error('An assembled React publication is required');
  const fixtureFile = await safeSiteFile(fixtures, '/__th20_native__/fixture-manifest.json');
  if (!fixtureFile || fixtureFile.directory) throw new Error('Build the separate TH20 native harness first');
  const fixture = JSON.parse(await readFile(fixtureFile.path, 'utf8'));
  if (fixture.schema !== 'eagler-touhou/th20-native-fixture/1' || fixture.testOnly !== true || fixture.scope !== 'test-only-native-adapter' || fixture.productionProductSupport !== false) {
    throw new Error('Build the separate TH20 native harness first');
  }
  return createPublishedSiteServer({root, resolveResource: nativeFixtureResourceResolver(root, fixtures)});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const match = /^--(publication|port)(?:=(.*))?$/.exec(process.argv[i]);
    if (!match) throw new Error(`Unknown native harness option: ${process.argv[i]}`);
    const value = match[2] ?? process.argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing --${match[1]}`);
    args[match[1]] = value;
  }
  if (!args.publication) throw new Error('Supply --publication=/absolute/path/to/an/already-assembled-publication');
  const port = Number(args.port ?? 4198);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid loopback port');
  const server = await createTh20NativeHarnessServer({publicationRoot: args.publication});
  server.listen(port, '127.0.0.1', () => console.log(`TEST ONLY; hidden TH20 native adapter, not public product support: http://127.0.0.1:${port}${server.uiMountPath}__th20_native__/index.html`));
}
