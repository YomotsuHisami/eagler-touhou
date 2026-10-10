import {createNetworkActivityTracker} from '../../src/launcher/network-activity.mts';
import type {GameId} from '../../src/contracts/product-catalog.mts';
import type {Translate} from '../i18n';

type Tracker = ReturnType<typeof createNetworkActivityTracker>;
/** Main app1372–1393. The descriptor/file type selects original copy only;
 * resource authority and URL validation remain with canonical installers. */
export function packageNetworkMetadata(gameId: GameId, input: RequestInfo | URL, baseUrl: string, t: Translate) {
  let pathname = '';
  try {
    const value = typeof input === 'string' ? input : input instanceof Request ? input.url : input.href;
    pathname = new URL(value, baseUrl).pathname;
  } catch {}
  const file = decodeURIComponent(pathname.split('/').at(-1) || pathname || t('transfer.resourceFallback'));
  const game = String(gameId || 'game').toUpperCase();
  if (/\.package\.json$/i.test(pathname)) return {title: t('transfer.fetchingGameInfo'), label: t('transfer.versionDescriptor', {game}), kind: 'descriptor'};
  if (/\.data$/i.test(pathname)) return {title: t('transfer.gameDownloading'), label: `${game} ${file}`, kind: 'game'};
  if (/\.wasm$/i.test(pathname)) return {title: t('transfer.runtimeDownloading'), label: `${game} WebAssembly`, kind: 'runtime'};
  if (/\.js$/i.test(pathname)) return {title: t('transfer.runtimeDownloading'), label: t('transfer.runtimeScript', {game}), kind: 'runtime'};
  if (/\.html$/i.test(pathname)) return {title: t('transfer.runtimeDownloading'), label: t('transfer.runtimePage', {game}), kind: 'runtime'};
  if (/\.ogg$/i.test(pathname)) return {title: t('transfer.musicDownloading'), label: file, kind: 'music'};
  if (/\.(?:ttc|otf|woff2?)$/i.test(pathname)) return {title: t('transfer.resourceDownloading'), label: t('transfer.font', {file}), kind: 'font'};
  if (/\.zip$/i.test(pathname)) return {title: t('transfer.packageDownloading'), label: file, kind: 'package'};
  return {title: t('transfer.serverRequesting'), label: `${game} ${file}`, kind: 'network'};
}

/** One visible tracker is supplied by the document host. Main's background
 * Package update has a separate silent tracker, while language owns its native
 * stream and explicitly publishes request/byte/completion to the visible one. */
export function createPreparationNetwork({foreground, baseUrl, translate: t, fetchImpl = globalThis.fetch, xhrFactory}: {
  foreground: Pick<Tracker, 'xhrFetch' | 'begin' | 'update' | 'finish'>;
  baseUrl: string;
  translate: Translate;
  fetchImpl?: typeof fetch;
  xhrFactory?: NonNullable<Parameters<typeof createNetworkActivityTracker>[0]>['xhrFactory'];
}) {
  const background = createNetworkActivityTracker({fetchImpl, ...(xhrFactory !== undefined ? {xhrFactory} : {})});
  return Object.freeze({
    packageFetch: (game: GameId): typeof fetch => (input, init) => foreground.xhrFetch(input, init, packageNetworkMetadata(game, input, baseUrl, t)),
    backgroundFetch: ((input, init) => background.xhrFetch(input, init)) as typeof fetch,
    beginLanguage(label: string) {
      const id = foreground.begin({title: t('language.downloading'), label: t('language.requesting', {language: label}), kind: 'language', phase: 'requesting'});
      return {
        received(loaded: number, total: number) {foreground.update(id, {phase: 'receiving', loaded, total, label});},
        finish() {foreground.finish(id);},
      };
    },
  });
}
export type PreparationNetwork = ReturnType<typeof createPreparationNetwork>;
