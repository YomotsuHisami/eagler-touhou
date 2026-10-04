/** Published singleplayer acquisition and configuration, independent of React/DOM.
 * No iframe, lease, launch, preference write or background transfer is owned here.
 * The canonical Package/Host/Runtime validators are shared with the bounded sample.
 */
import { unzipSync } from 'fflate';
import { PRODUCT_GAMES, languagePriority, productFeatureAvailable, type GameId } from '../../src/contracts/product-catalog.mts';
import { componentFileIds } from '../../package/package-generation.mjs';
import { buildLanguageCatalog, resolveLanguagePackSource, thpracLocaleForLanguage } from '../../src/launcher/language-catalog.mts';
import { validateStaticLanguagePackEntries } from '../../src/launcher/language-pack-validation.mts';
import { resolveEffectiveMusicMode } from '../../src/launcher/music-availability.mts';
import { sha256Hex } from '../../src/launcher/sha256.mts';
import { acquirePublishedGeneration, resolvePublishedGame, publishedDependencies, publishedIO,
  checkPublishedCancelled, SampleLaunchError, sampleErrorText,
  type ResolvedPublishedGame, type SampleAssetCheck, type SampleLaunchReason, type Th06SampleOptions,
} from './sample-launch.client';
import type { PreferencesContext, PreferencesSnapshot } from './preferences.client';
import type { RuntimePlan, RuntimeSnapshot } from './runtime.client';
import type { PackageInstallProgress } from '../../package/package-installer.mjs';

export interface PublishedGameOptions extends Th06SampleOptions {
  productId: string;
  uiLocale?: string;
  audioAvailable?: boolean;
  /** Supply only when the root Runtime MIDI synth/bridge owner is installed. */
  midiAvailable?: boolean;
}
export interface PublishedGameInspection {
  productId: string;
  game: GameId | null;
  available: boolean;
  status: 'installed' | 'installable' | 'unavailable';
  reason: SampleLaunchReason | null;
  checks: readonly SampleAssetCheck[];
  runtimeVerified: false;
  packageVerified: false;
  generationId: string | null;
  preferencesContext: PreferencesContext | null;
  limitations: readonly string[];
}
export interface PreparePublishedGameOptions extends PublishedGameOptions {
  preferences: PreferencesSnapshot;
  runtimeService: { prepare(plan: RuntimePlan): Promise<RuntimeSnapshot> };
  onProgress?: (progress: PackageInstallProgress) => void;
}
const limitations = Object.freeze([
  'OGG acquisition completes before preparation; progressive in-game downloads are not yet connected.',
  'MIDI requires the root synthesizer bridge; unavailable bridges are never reported as playable MIDI.',
]);
function failure(code: ConstructorParameters<typeof SampleLaunchError>[0], message: string): never {
  throw new SampleLaunchError(code, message);
}
function context(resolved: ResolvedPublishedGame, options: PublishedGameOptions): PreferencesContext {
  const {game, host, generation, descriptor, catalog} = resolved;
  const published = host.games[game]!;
  const oggIds = componentFileIds(descriptor, 'ogg');
  return {
    uiLocale: options.uiLocale ?? 'zh-CN', hostFeatures: published.features ?? {},
    languageCatalog: buildLanguageCatalog({languageOptions: published.languageOptions,
      legacyLanguages: published.languages, generation, priority: languagePriority}),
    musicAvailability: {
      audio: options.audioAvailable !== false,
      midiAvailable: options.midiAvailable === true && PRODUCT_GAMES[game].musicCapabilities.midi && published.music.midi.supported !== false,
      importServer: host.shared.resourceMode === 'import',
      remoteOggAdvertised: oggIds.length >= 2 && catalog?.games[game]?.revision === descriptor.revision,
      remoteRevision: catalog?.games[game]?.revision ?? null,
      installed: generation ? { revision: descriptor.revision, oggFileIds: oggIds, files: generation.files } : null,
    },
  };
}
export async function inspectPublishedGame(options: PublishedGameOptions): Promise<PublishedGameInspection> {
  const checks: SampleAssetCheck[] = [];
  try {
    const resolved = await resolvePublishedGame(options, checks);
    return {productId: options.productId, game: resolved.game, available: true,
      status: resolved.generation ? 'installed' : 'installable', reason: null, checks,
      runtimeVerified: false, packageVerified: false, generationId: resolved.generation?.id ?? null,
      preferencesContext: context(resolved, options), limitations};
  } catch (error) {
    const reason = error instanceof SampleLaunchError ? error : new SampleLaunchError('prepare-failed', sampleErrorText(error));
    return {productId: options.productId, game: null, available: false, status: 'unavailable',
      reason: {code: reason.code, message: reason.message}, checks, runtimeVerified: false,
      packageVerified: false, generationId: null, preferencesContext: null, limitations};
  }
}

async function prepareLanguage(resolved: ResolvedPublishedGame, options: PublishedGameOptions, language: string) {
  if (language === 'ja') return null;
  const entry = context(resolved, options).languageCatalog?.find(item => item.id === language);
  if (!entry) failure('language-unavailable', 'The selected language is not in the current Host/Package catalog');
  const source = resolveLanguagePackSource(entry, resolved.baseUrl);
  if (!source) failure('language-unavailable', 'The selected translation has no published or installed language pack');
  const deps = publishedDependencies(options);
  let archive: Uint8Array;
  let url: string;
  if (source.packageLocal === true) {
    const id = source.packageFile;
    const declaration = id ? resolved.descriptor.files[id] : undefined;
    const ref = id ? resolved.generation?.files[id] : undefined;
    if (!declaration?.sha256 || ref?.objectId !== source.packageObjectId || ref.revision !== declaration.revision) {
      failure('integrity-failed', 'The installed language pack identity is inconsistent');
    }
    const object = await deps.readObject(source.packageObjectId);
    checkPublishedCancelled(options.signal);
    const buffer = object?.data instanceof ArrayBuffer ? object.data : object?.blob instanceof Blob ? await object.blob.arrayBuffer() : null;
    if (!buffer || buffer.byteLength !== declaration.bytes || await sha256Hex(buffer) !== declaration.sha256.toLowerCase()) {
      failure('integrity-failed', 'The installed language pack failed byte/SHA-256 verification');
    }
    archive = new Uint8Array(buffer);
    url = new URL(`__eagler/package-language/${resolved.game}/${encodeURIComponent(language)}`, resolved.baseUrl).href;
  } else {
    const remote = new URL(source.url), base = new URL(resolved.baseUrl);
    if (remote.origin !== base.origin || !remote.pathname.startsWith(base.pathname)) {
      failure('language-unavailable', 'Language packs must be inside the same-origin application mount');
    }
    url = remote.href;
    const buffer = await publishedIO(options, [])(url, 'package', response => response.arrayBuffer());
    if (buffer.byteLength !== source.bytes || await sha256Hex(buffer) !== source.sha256.toLowerCase()) {
      failure('integrity-failed', 'The published language pack failed byte/SHA-256 verification');
    }
    archive = new Uint8Array(buffer);
  }
  checkPublishedCancelled(options.signal);
  const pack = validateStaticLanguagePackEntries(unzipSync(archive), {game: resolved.game, language});
  checkPublishedCancelled(options.signal);
  return {language, url, bytes: archive.byteLength, runtimeVersion: pack.manifest.runtimeVersion, ...pack};
}

/** Exact click-time settings are isolated before network work. Never starts a game. */
export async function preparePublishedGame(input: PreparePublishedGameOptions): Promise<RuntimeSnapshot> {
  const options = {...input, preferences: structuredClone(input.preferences)};
  const prefs = options.preferences;
  if (prefs.productId !== options.productId || prefs.preferenceId !== options.productId) {
    failure('unsupported-product', 'The preference snapshot does not belong to the requested singleplayer product');
  }
  const resolved = await resolvePublishedGame(options, []);
  const metadata = context(resolved, options);
  const language = prefs.language;
  if (!language || !metadata.languageCatalog?.some(entry => entry.id === language)) {
    failure('language-unavailable', 'Refresh the current language catalog before preparing the game');
  }
  if (prefs.music === null) failure('unsupported-music', 'Refresh the current music metadata before preparing the game');
  if (prefs.music === 'midi' && options.midiAvailable !== true) {
    failure('unsupported-music', 'MIDI synthesis is not connected in this entry. Select OGG or no music.');
  }
  const music = resolveEffectiveMusicMode({...metadata.musicAvailability!, requested: prefs.music, explicit: true});
  if (music !== prefs.music) failure('unsupported-music', 'The selected music is no longer available; refresh the resource catalog');
  const oggIds = music === 'ogg-stream' || music === 'ogg-full' ? componentFileIds(resolved.descriptor, 'ogg') : [];
  const mount = PRODUCT_GAMES[resolved.game].package.musicMounts.ogg;
  for (const id of oggIds) {
    const file = resolved.descriptor.files[id];
    const name = file?.source.split('/').at(-1);
    if (!file || !name || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.ogg$/i.test(name) || file.source !== `games/${resolved.game}/music/ogg/${name}` || file.target !== `${mount}/${name}`) {
      failure('unsupported-package', `${id}: OGG must use the canonical product music mount`);
    }
  }
  const generation = await acquirePublishedGeneration(options, resolved, oggIds);
  // Bind language acquisition to the exact generation returned by acquisition.
  const runtimePack = await prepareLanguage({...resolved, generation, descriptor: generation.descriptor}, options, language);
  const features = resolved.host.games[resolved.game]!.features;
  const stored = prefs.options;
  const plan: RuntimePlan = { game: resolved.game, runtimeVariant: 'normal', generation, entry: resolved.entry,
    publishedRuntime: true, resourceFileIds: [...resolved.baseIds.filter(id => id !== 'game-data'), ...oggIds],
    configure: {music: oggIds.length ? 'ogg' : music === 'midi' ? 'midi' : 'none', language,
      resources: [], runtimeResources: [], sharedResources: [], runtimePack,
      options: {limitPresentationTo60: stored.frameLimit60Enabled, touchEnabled: stored.touchEnabled,
        touchMovementMode: stored.touchMovementMode, touchSensitivity: stored.touchSensitivity,
        touchFocusMode: stored.touchFocusMode, doubleTapBombEnabled: stored.doubleTapBombEnabled,
        alwaysHitbox: stored.alwaysHitbox, oggDecodeMode: music === 'ogg-full' ? 'full' : 'stream',
        ...(productFeatureAvailable(resolved.game, 'thprac', features) ? {thpracEnabled: stored.thpracEnabled, thpracLocale: thpracLocaleForLanguage(language)} : {}),
        ...(productFeatureAvailable(resolved.game, 'focusHitbox', features) ? {focusHitboxEnabled: stored.focusHitboxEnabled} : {}),
      }},
  };
  checkPublishedCancelled(options.signal);
  return options.runtimeService.prepare(plan);
}
