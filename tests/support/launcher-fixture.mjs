import {createHash} from 'node:crypto';
import {createReadStream, constants} from 'node:fs';
import {copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, resolve, sep} from 'node:path';
import {createDevelopmentHostManifestFromContent} from '../../lib/development-host-manifest.mjs';
import {validateHostManifest} from '../../lib/contracts/host-manifest.mjs';
import {RELEASE_CATALOG_SCHEMA, validateReleaseCatalog} from '../../lib/contracts/release-catalog.mjs';

function relativeFile(value) {
  if (typeof value !== 'string' || !value || isAbsolute(value) || value.includes('\\') || value.includes('\0') ||
      value.split('/').some(part => !part || part === '.' || part === '..') || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
    throw new Error('Fixture DATA source must be a confined relative path');
  }
  return value;
}
function confined(root, path) {return path === root || path.startsWith(root + sep);}
async function copyTree(source, destination) {
  await mkdir(destination, {recursive: true});
  for (const item of await readdir(source, {withFileTypes: true})) {
    if (item.isSymbolicLink()) throw new Error('Fixture artifact trees must not contain symbolic links');
    const from = resolve(source, item.name), to = resolve(destination, item.name);
    if (item.isDirectory()) await copyTree(from, to);
    else if (item.isFile()) await copyFile(from, to, constants.COPYFILE_FICLONE);
  }
}
async function verifyData(root, declaration) {
  const source = relativeFile(declaration.source), file = await realpath(resolve(root, source));
  if (!confined(root, file)) throw new Error('Fixture DATA source escapes its input root');
  const identity = declaration.identity, info = await stat(file);
  if (!info.isFile() || !Number.isSafeInteger(identity?.bytes) || info.size !== identity.bytes || !/^[a-f0-9]{64}$/.test(identity.sha256 || '')) {
    throw new Error('Fixture DATA size or declared SHA-256 is invalid');
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== identity.sha256) throw new Error('Fixture DATA SHA-256 mismatch');
  return {source, file, bytes: info.size, sha256: identity.sha256};
}
function localRelay(value) {
  if (!value) return undefined;
  const url = new URL(value);
  if (!['ws:', 'wss:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw new Error('Original UI fixture Relay must be the test process loopback endpoint');
  }
  return url.href;
}

/** Opt-in setup for original protocol-stub browser cases. Every run receives a
 * private copy of the selected UI tree. DATA identities are checked before
 * serving; metadata uses the unchanged main generator and inherited test Relay.
 * This does not add native engine fixtures or change scenario assertions. */
export async function prepareLauncherFixture(artifactRoot, declarationPath, environment = process.env) {
  const declarationFile = await realpath(resolve(declarationPath));
  const declaration = JSON.parse(await readFile(declarationFile, 'utf8'));
  if (declaration.schema !== 'eagler-touhou/original-ui-fixture/1' || !declaration.content?.games || !declaration.content?.shared) {
    throw new Error('Invalid original UI fixture declaration');
  }
  if (Object.keys(declaration.content.shared).some(key => !['vanillaFont', 'unicodeFont'].includes(key))) {
    throw new Error('Fixture shared inputs may only declare original font aliases; Relay and authority are setup-owned');
  }
  for (const path of Object.values(declaration.content.shared)) relativeFile(path);
  const sourceRoot = await realpath(resolve(dirname(declarationFile), declaration.inputRoot || '.'));
  const selected = environment.EAGLER_DEVELOPMENT_GAMES?.split(',').map(value => value.trim()).filter(Boolean);
  if (selected?.some(game => !Object.hasOwn(declaration.content.games, game))) throw new Error('Selected game is absent from the explicit fixture declaration');
  const relay = localRelay(environment.EAGLER_TOUHOU_NETPLAY_RELAY);
  if (declaration.requireRelay === true && !relay) throw new Error('Original scenario must supply its allocated local Relay before fixture startup');
  const files = [];
  for (const [game, content] of Object.entries(declaration.content.games)) {
    if (selected && !selected.includes(game)) continue;
    for (const path of [content.runtime, content.multiplayerRuntime].filter(Boolean)) relativeFile(path.replace(/^\.\//, ''));
    if (content.data?.source) files.push(await verifyData(sourceRoot, content.data));
    if (Object.keys(content.music || {}).length) throw new Error('Protocol-stub fixture must not introduce extra music payloads');
  }
  const host = validateHostManifest(await createDevelopmentHostManifestFromContent(declaration.content, {
    sourceRoot, games: selected || Object.keys(declaration.content.games), netplayRelay: relay,
  }));
  const catalog = validateReleaseCatalog({schema: RELEASE_CATALOG_SCHEMA, games: {}});
  const artifacts = await realpath(resolve(artifactRoot));
  if (!(await stat(resolve(artifacts, 'index.html'))).isFile()) throw new Error('Fixture UI index is missing');
  const work = await mkdtemp(resolve(tmpdir(), 'eagler-original-ui-')), root = resolve(work, 'site');
  const dispose = () => rm(work, {recursive: true, force: true});
  try {
    await copyTree(artifacts, root);
    for (const file of files) {
      const target = resolve(root, file.source);
      if (!confined(root, target)) throw new Error('Fixture destination escapes private root');
      await mkdir(dirname(target), {recursive: true});
      await copyFile(file.file, target, constants.COPYFILE_FICLONE);
      // Verify the staged copy as well; a changed source cannot silently enter.
      await verifyData(root, {source: file.source, identity: file});
    }
    await writeFile(resolve(root, 'host-manifest.json'), JSON.stringify(host, null, 2) + '\n');
    await writeFile(resolve(root, 'release-catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
    return {root, host, catalog, files: files.map(({source, bytes, sha256}) => ({source, bytes, sha256})), dispose};
  } catch (error) {await dispose(); throw error;}
}
