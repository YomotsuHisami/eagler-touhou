import type {ProductId, MultiplayerProductId} from '../src/contracts/product-catalog.mts';
import type {RestoredMultiplayerRoomSession} from '../src/launcher/multiplayer-room-session.mts';

export const UI_DEPLOYMENT_SCHEMA: 'eagler-touhou/ui-deployment/1';
export type UiLegacyEntry = '/index.html' | '/en.html' | '/lobby.html';
export const UI_LEGACY_ENTRIES: readonly UiLegacyEntry[];
export const UI_RESOURCE_PREFIXES: readonly string[];
/** Explicit migrated locale hint; this helper does not translate React UI. */
export const UI_LOCALE_QUERY: 'uiLocale';

export interface UiDeploymentContract {
  readonly schema: typeof UI_DEPLOYMENT_SCHEMA;
  readonly mountPath: string;
  readonly shellPath: string;
  readonly patterns: readonly string[];
  readonly legacyEntries: readonly UiLegacyEntry[];
  readonly resourcePrefixes: readonly string[];
  readonly missingAssetPolicy: '404';
  readonly externalResourcePrefixes: readonly ['/games/', '/shared/'];
}

export function decodeUiDeploymentPath(value: unknown): string | null;
export function createUiDeploymentContract(options: {
  /** Derived from app/routes.ts by scripts/ui-routing.mjs. */
  patterns: readonly string[];
  mountPath?: string;
  legacyEntries?: readonly UiLegacyEntry[];
}): UiDeploymentContract;
export function isUiDeploymentNavigation(pathname: string, contract: UiDeploymentContract): boolean;

export interface UiNavigationRequest {
  readonly url: string | URL;
  readonly method?: string;
  readonly destination?: string;
  readonly mode?: string;
  readonly headers?: Pick<Headers, 'get'>;
  readonly accept?: string;
}
/** Returns an absolute shell cache URL for an eligible navigation, else null. */
export function uiNavigationFallback(request: string | URL | UiNavigationRequest, options: {
  contract: UiDeploymentContract;
  scopeUrl: string | URL;
}): string | null;

/** Pass the existing Product Catalog namespace, or this exact policy subset. */
export type LegacyUiCatalog = Pick<typeof import('../src/contracts/product-catalog.mts'),
  'isProductId' | 'isMultiplayerProductId' | 'productEnabledForBuild' |
  'multiplayerConfigForProduct' | 'DEFAULT_MULTIPLAYER_PRODUCT_ID'>;

export interface LegacyUiRoom {
  readonly code: string;
  readonly playerCount: 2 | 3;
  readonly difficulty: number;
  readonly created: boolean;
  readonly visibility: 'public' | 'private';
  readonly disableCheatMovement: boolean;
  readonly seat: number | null;
  readonly ready: boolean;
  readonly spectatorRequested: boolean;
  readonly roomSettingsOpen: boolean;
}
export interface LegacyUiEntryBase {
  readonly locale: 'en' | 'zh-CN';
  /** Origin-relative canonical target, including preserved search and hash. */
  readonly to: string;
  /** Absolute same-origin canonical target. */
  readonly href: string;
  readonly replace: true;
  /** Parsing a product or room URL never authorizes starting a game. */
  readonly autoLaunch: false;
}
export type LegacyUiEntry =
  | (LegacyUiEntryBase & {readonly kind: 'library'; readonly productId: null})
  | (LegacyUiEntryBase & {readonly kind: 'product'; readonly productId: ProductId})
  | (LegacyUiEntryBase & {readonly kind: 'lobby'; readonly productId: MultiplayerProductId | null})
  | (LegacyUiEntryBase & {
      readonly kind: 'room';
      readonly productId: MultiplayerProductId;
      readonly room: Readonly<LegacyUiRoom>;
      readonly returnToDirectory: boolean;
      readonly directoryAction: 'create' | 'join' | null;
      readonly autoSeat: boolean;
    });

export function resolveLegacyUiEntry(input: string | URL, options: {
  /** Same-origin application directory URL ending in a slash. */
  baseUrl: string | URL;
  catalog: LegacyUiCatalog;
  /** Reuse src/launcher/route-state.mts, without installing its history owner. */
  normalizeRoomCode: typeof import('../src/launcher/route-state.mts').normalizeRoomCode;
  testBuild?: boolean;
  /** Already normalized by multiplayer-room-session.load(), never raw storage. */
  savedRoom?: RestoredMultiplayerRoomSession | null;
}): LegacyUiEntry | null;
