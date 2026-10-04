/** TEST-ONLY hidden TH20 adapter boundary. Never imported by app/ or publication builds.
 * Uses canonical validators and the real Package Store. It does not relax the
 * public product gate, which must continue to reject TH20 even in testBuild.
 */
import {PRODUCT_GAMES, productEnabledForBuild} from '../../src/contracts/product-catalog.mts';
import {validateHostManifest, type HostManifest} from '../../src/contracts/host-manifest.mts';
import {canonicalRuntimePayload, findRuntimeGroup, parseRuntimeGenerationPath, validateRuntimeManifest} from '../../src/contracts/runtime-generations.mts';
import {canonicalPublishedDescriptor, canonicalPublishedGeneration} from '../../app/services/sample-launch.client';
import {sha256Hex} from '../../src/launcher/sha256.mts';
import {parsePackageZip} from '../../package/package-zip.mjs';
import {installPackageFromAcquisition} from '../../package/package-installer.mjs';
import {readCurrentPackageGeneration, readPackageObject} from '../../package/package-store.mjs';
import {componentFileIds} from '../../package/package-generation.mjs';
import type {InstalledPackageGeneration} from '../../src/contracts/package-read-models.mts';
import type {RuntimePlan} from '../../app/services/runtime.client';

export interface NativePins {baseUrl: string; hostSha256: string; runtimeGeneration: string; packageSha256: string}
export interface VerifiedPublication {host: HostManifest; entry: string; pins: NativePins}
const hashPattern = /^[a-f0-9]{64}$/;
function assert(condition: unknown, message: string): asserts condition {if (!condition) throw new Error(message);}
export async function verifyNativePublication(pins: NativePins): Promise<VerifiedPublication> {
  const base = new URL(pins.baseUrl);
  assert(['http:', 'https:'].includes(base.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) &&
    base.origin === location.origin && base.pathname.endsWith('/') && !base.search && !base.hash && !base.username && !base.password,
    'An explicit same-origin loopback assembled publication is required');
  assert(hashPattern.test(pins.hostSha256) && hashPattern.test(pins.runtimeGeneration) && hashPattern.test(pins.packageSha256), 'Explicit exact Host, Runtime and Package identities are required');
  assert(PRODUCT_GAMES.th20.hidden && !productEnabledForBuild('th20') && !productEnabledForBuild('th20', true), 'TH20 must stay hidden in every public catalog build');
  const read = async (path: string) => {
    const response = await fetch(new URL(path, base), {cache: 'no-store', redirect: 'error'});
    assert(response.ok && response.headers.get('content-type')?.includes('application/json'), `Expected publication JSON: ${path}`);
    return response.text();
  };
  const marker = JSON.parse(await read('ui-publication.json'));
  assert(marker.schema === 'eagler-touhou/ui-publication/1' && ['react-main', 'experimental-opt-in'].includes(marker.status) &&
    marker.mountPath === base.pathname && hashPattern.test(marker.uiBuild?.sha256), 'An assembled current React publication is required');
  const hostText = await read('host-manifest.json');
  assert(await sha256Hex(new TextEncoder().encode(hostText)) === pins.hostSha256, 'Host identity changed after native-lane preflight');
  const host = validateHostManifest(JSON.parse(hostText));
  assert(host.shared.runtimeManifest === 'runtime-manifest.json' && host.games.th20, 'The explicit Host must supply an immutable TH20 Runtime');
  const entry = new URL(host.games.th20.runtime, base);
  assert(entry.origin === base.origin && entry.pathname.startsWith(base.pathname) && !entry.search && !entry.hash, 'TH20 Runtime must be inside the publication mount');
  const path = entry.pathname.slice(base.pathname.length), identity = parseRuntimeGenerationPath(path);
  assert(identity?.root === 'runtime/th20/' && identity.file === 'th20.html' && identity.generation === pins.runtimeGeneration,
    'Host Runtime does not match the explicitly selected TH20 generation');
  const manifest = validateRuntimeManifest(JSON.parse(await read('runtime-manifest.json'))), group = findRuntimeGroup(manifest, path);
  assert(group?.root === 'runtime/th20/' && group.current.generation === pins.runtimeGeneration && group.current.entry === 'th20.html', 'The requested exact Runtime must be current in this publication');
  assert(await sha256Hex(new TextEncoder().encode(canonicalRuntimePayload(group.current.entry, group.current.files))) === pins.runtimeGeneration,
    'Runtime generation identity mismatch');
  assert(group.current.files.some(file => file.path === 'th20-sdl.wasm' && file.bytes > 8), 'A native TH20 WASM entry is required');
  return {host, entry: entry.href, pins};
}
export async function verifyNativePackage(file: File, publication: VerifiedPublication) {
  assert(file.size > 0 && file.size <= 256 * 1024 * 1024, 'Supply the explicit TH20 Package ZIP, up to 256 MiB');
  assert(await sha256Hex(new Uint8Array(await file.arrayBuffer())) === publication.pins.packageSha256, 'Selected ZIP does not match the explicit local Package input');
  const parsed = await parsePackageZip(file);
  const descriptor = canonicalPublishedDescriptor(parsed.descriptor, publication.host, 'th20', {installed: true});
  const ids = [...parsed.files.keys()];
  assert(descriptor.base.files.every(id => ids.includes(id)), 'Package ZIP is missing required DATA/fonts');
  const oggIds = componentFileIds(descriptor, 'ogg');
  assert(oggIds.length >= 2 && oggIds.every(id => ids.includes(id)), 'Explicit Package must contain the imported OGG component');
  for (const id of ids) {
    const declaration = descriptor.files[id], blob = parsed.files.get(id)?.blob;
    assert(declaration && blob instanceof Blob && Number.isSafeInteger(declaration.bytes) && declaration.bytes === blob.size &&
      typeof declaration.sha256 === 'string' && hashPattern.test(declaration.sha256), `${id}: full Package integrity is required`);
    assert(await sha256Hex(new Uint8Array(await blob.arrayBuffer())) === declaration.sha256, `${id}: Package SHA-256 mismatch`);
  }
  for (const id of oggIds) {
    const file = descriptor.files[id], name = file.source.split('/').at(-1);
    assert(name && /^[A-Za-z0-9][A-Za-z0-9._-]*\.ogg$/i.test(name) && file.target === `${PRODUCT_GAMES.th20.package.musicMounts.ogg}/${name}`, `${id}: noncanonical OGG mount`);
  }
  return parsed;
}
export async function importVerifiedNativePackage(file: File, publication: VerifiedPublication) {
  const parsed = await verifyNativePackage(file, publication), descriptor = parsed.descriptor, ids = [...parsed.files.keys()];
  const previous = await readCurrentPackageGeneration('th20');
  const result = await installPackageFromAcquisition({descriptor, desiredFileIds: ids, source: 'local', reuseCurrent: false,
    expectedGenerationId: previous.generation?.id ?? null,
    acquire: async (id: string) => parsed.files.get(id)!.blob.arrayBuffer()});
  canonicalPublishedGeneration(result.generation, publication.host, 'th20');
  assert(result.installation.currentGeneration === result.generation.id && result.installation.source === 'local', 'Imported generation ownership mismatch');
  return result.generation;
}
export async function verifiedNativePlan(generation: InstalledPackageGeneration, original: VerifiedPublication,
  selection: {music: 'none' | 'ogg'; touch: boolean; movement: 'touch' | 'touch-unlimited'}): Promise<RuntimePlan> {
  // Recheck exact Host/Runtime identity and committed Package ownership at click time.
  const publication = await verifyNativePublication(original.pins), current = await readCurrentPackageGeneration('th20');
  assert(current.installation?.source === 'local' && current.installation.currentGeneration === generation.id && current.generation?.id === generation.id,
    'The explicitly imported Package is no longer current');
  const descriptor = canonicalPublishedGeneration(generation, publication.host, 'th20');
  for (const [id, reference] of Object.entries(generation.files)) {
    const file = descriptor.files[id];
    assert(reference?.objectId && reference.revision === file.revision, `${id}: Package generation reference mismatch`);
    const object = await readPackageObject(reference.objectId), buffer = object?.data ?? await object?.blob?.arrayBuffer();
    assert(buffer instanceof ArrayBuffer && buffer.byteLength === file.bytes && await sha256Hex(new Uint8Array(buffer)) === file.sha256,
      `${id}: installed Package integrity mismatch`);
  }
  const oggIds = selection.music === 'ogg' ? componentFileIds(descriptor, 'ogg') : [];
  const resources = Object.entries(descriptor.components).filter(([, value]) => value.type === 'resource').flatMap(([id]) => componentFileIds(descriptor, id));
  return {game: 'th20', runtimeVariant: 'normal', entry: publication.entry, generation, publishedRuntime: true,
    resourceFileIds: [...new Set([...descriptor.base.files.filter(id => id !== 'game-data'), ...resources, ...oggIds])],
    launcherControls: {restartButtonEnabled: false, thpracTouchControlsEnabled: false, magnifierEnabled: false, touchLayout: null},
    configure: {music: selection.music, language: 'ja', resources: [], runtimeResources: [], sharedResources: [],
      options: {limitPresentationTo60: true, touchEnabled: selection.touch, touchMovementMode: selection.movement,
        touchSensitivity: 150, touchFocusMode: 'hold-button', doubleTapBombEnabled: false, oggDecodeMode: 'stream'}}};
}
