import {useLocale} from './LocaleProvider';
import {useCallback, useEffect, useRef, useState} from 'react';
import {useHref, useLocation, useNavigate, useNavigation} from 'react-router';
import * as catalog from '../../src/contracts/product-catalog.mts';
import {normalizeRoomCode} from '../../src/launcher/route-state.mts';
import {createMultiplayerRoomSessionStore, type MultiplayerRoomSessionStore} from '../../src/launcher/multiplayer-room-session.mts';
import {resolveLegacyUiEntry, type LegacyUiEntry} from '../../scripts/ui-deployment-contract.mjs';

export const LEGACY_ENTRY_STATE_KEY = 'legacyEntryIntent';
type RoomReader = MultiplayerRoomSessionStore['load'];
export interface LegacyEntryNavigation {
  readonly intent: LegacyUiEntry;
  readonly target: {readonly pathname: string; readonly search: string; readonly hash: string};
  readonly state: Readonly<Record<string, unknown>>;
}

/** Inert planning seam: browser storage is available only through an explicit
 * reader. This function does not start a Runtime, join a room or change history. */
export function resolveLegacyEntryNavigation({url, baseUrl, routerBasePath = '/', previousState, testBuild = false, readRoom}: {
  url: string;
  baseUrl: string;
  /** Public useHref('/') value, so navigate() never doubles a Router basename. */
  routerBasePath?: string;
  previousState?: unknown;
  testBuild?: boolean;
  readRoom?: RoomReader;
}): LegacyEntryNavigation | null {
  const options = {baseUrl, catalog, normalizeRoomCode, testBuild};
  let intent = resolveLegacyUiEntry(url, options);
  if (!intent) return null;
  if (intent.kind === 'room' && readRoom) {
    const policy = catalog.multiplayerConfigForProduct(intent.productId);
    if (policy) {
      let savedRoom: ReturnType<RoomReader> = null;
      try { savedRoom = readRoom({product: intent.productId, roomCode: intent.room.code,
        playerCounts: policy.playerCounts, difficulties: policy.difficulties}); }
      catch { /* Unavailable optional session storage must not block the URL. */ }
      intent = resolveLegacyUiEntry(url, {...options, savedRoom})!;
    }
  }
  const source = new URL(url), destination = new URL(intent.href);
  if (source.href === destination.href) return null;
  const basename = new URL(routerBasePath, baseUrl).pathname.replace(/\/$/, '') || '/';
  let pathname = destination.pathname;
  if (basename !== '/') {
    if (pathname === basename || pathname === `${basename}/`) pathname = '/';
    else if (pathname.startsWith(`${basename}/`)) pathname = pathname.slice(basename.length);
    else throw new Error('Legacy destination is outside the Router basename');
  }
  const oldState = previousState && typeof previousState === 'object' && !Array.isArray(previousState)
    ? previousState as Record<string, unknown> : {};
  return Object.freeze({intent,
    target: Object.freeze({pathname, search: destination.search, hash: destination.hash}),
    state: Object.freeze({...oldState, [LEGACY_ENTRY_STATE_KEY]: intent}),
  });
}

export interface LegacyEntryAdapterOptions {
  enabled?: boolean;
  /** Defaults to the public Router root at the current origin, after mount only. */
  baseUrl?: string;
  testBuild?: boolean;
}
export interface LegacyEntryAdapterSnapshot {
  readonly status: 'idle' | 'replacing' | 'error';
  readonly intent: LegacyUiEntry | null;
  readonly error: string | null;
}
const idle: LegacyEntryAdapterSnapshot = Object.freeze({status: 'idle', intent: null, error: null});

/** Mount once at the document root inside the data Router. Alias routes are
 * display-only; no route mounts another adapter or native history listener. */
export function useLegacyEntryAdapter({enabled = true, baseUrl, testBuild = false}: LegacyEntryAdapterOptions = {}) {
  const location = useLocation(), navigation = useNavigation(), navigate = useNavigate(), routerBasePath = useHref('/');
  const [snapshot, setSnapshot] = useState<LegacyEntryAdapterSnapshot>(idle);
  const [retrySerial, setRetrySerial] = useState(0);
  const mounted = useRef(false);
  const latestSource = useRef(location.key);
  const attempted = useRef<{source: string; destination: string} | null>(null);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  useEffect(() => {
    latestSource.current = location.key;
    if (!enabled || navigation.state !== 'idle') return;
    const root = new URL(routerBasePath, window.location.origin);
    const prefix = root.pathname.replace(/\/$/, '');
    const current = new URL(`${prefix}${location.pathname}`, window.location.origin);
    current.search = location.search; current.hash = location.hash;
    // A newer history commit can precede its deferred Router render. Do not
    // replace that newer destination using an older committed route snapshot.
    if (current.href !== window.location.href) return;
    let plan: LegacyEntryNavigation | null;
    try {
      plan = resolveLegacyEntryNavigation({url: current.href,
        baseUrl: baseUrl ?? new URL(root.pathname.endsWith('/') ? root.pathname : `${root.pathname}/`, root.origin).href,
        routerBasePath, previousState: location.state, testBuild,
        // Creation and reads both stay inside this effect, never SSR/render.
        readRoom: input => createMultiplayerRoomSessionStore().load(input),
      });
    } catch (error) {
      attempted.current = null;
      setSnapshot({status: 'error', intent: null, error: error instanceof Error ? error.message : String(error)});
      return;
    }
    if (!plan) {attempted.current = null; setSnapshot(idle); return;}
    const source = `${location.key}:${current.href}`;
    if (attempted.current?.source === source && attempted.current.destination === plan.intent.href) return;
    const ticket = {source, destination: plan.intent.href};
    attempted.current = ticket;
    setSnapshot({status: 'replacing', intent: plan.intent, error: null});
    const fail = (error: unknown) => {
      if (!mounted.current || attempted.current !== ticket || latestSource.current !== location.key) return;
      setSnapshot({status: 'error', intent: plan!.intent, error: error instanceof Error ? error.message : String(error)});
    };
    try {
      void Promise.resolve(navigate(plan.target, {replace: true, state: plan.state, preventScrollReset: true})).catch(fail);
    } catch (error) {fail(error);}
  }, [enabled, baseUrl, testBuild, location, navigation.state, navigate, routerBasePath, retrySerial]);
  const retry = useCallback(() => {attempted.current = null; setRetrySerial(value => value + 1);}, []);
  return {snapshot, retry};
}

/** Route intent and translated error presentation remain separate concerns. */
export function LegacyEntryAdapter(options: LegacyEntryAdapterOptions) {
  const {t} = useLocale();
  const {snapshot, retry} = useLegacyEntryAdapter({...options, testBuild: options.testBuild ?? true});
  return snapshot.error ? <aside role="alert" className="mx-auto my-3 max-w-3xl rounded-xl border border-line bg-panel p-3 text-sm">
    <p>{t('react.legacy.openFailed', {reason:snapshot.error})}</p>
    <button type="button" className="mt-2 min-h-11 rounded-lg border border-line px-3" onClick={retry}>{t('react.legacy.retry')}</button>
  </aside> : null;
}
