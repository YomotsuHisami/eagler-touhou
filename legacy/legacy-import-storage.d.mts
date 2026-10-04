import type { ParsedPackageZip } from "../package/package-zip.mjs";

export interface LegacySharedAsset {target: string; key: string; bytes: number; sha256: string}
export interface LegacyLanguageAsset {id: string; title: string; key: string; bytes: number; sha256: string}
export interface LegacyGameDataMetadata {
  source: 'local-import'; game: string; version: string; layout: string; sha256: string; bytes: number;
  legacyAssets: {runtimeVersion?: string; shared: LegacySharedAsset[]; languages: LegacyLanguageAsset[]} | null;
}
export interface LegacyStoredImportState {
  game: string; gameData: LegacyGameDataMetadata;
  ogg: {version: string; files: string[]} | null;
  assets: Map<string, Blob>; dataKey: string; incomplete?: string; missing?: string[];
}
export interface LegacyStorageOptions {
  origin?: string;
  storage?: Pick<Storage, 'getItem' | 'removeItem'> | null;
  indexedDBFactory?: IDBFactory | null;
  cacheStorage?: Pick<CacheStorage, 'match' | 'open' | 'delete'> | null;
}
export interface LegacyMigrationResult {
  status: "migrated" | "already-current" | "incomplete" | "absent";
  missing?: unknown;
}
export function importedGameDataMetadataKey(game: string): string;
export function importedOggMetadataKey(game: string): string;
export function localGameDataCacheUrl(origin: string, game: string, version: string): string;
export function localOggCacheUrl(origin: string, game: string, version: string, filename: string): string;
export function readLegacyGameDataMetadata(game: string, options?: Pick<LegacyStorageOptions, 'storage'> & {fallbackGameData?: unknown}): LegacyGameDataMetadata | null;
export function loadLegacyStoredImport(game: string, options?: LegacyStorageOptions & {fallbackGameData?: unknown}): Promise<LegacyStoredImportState | null>;
export function migrateLegacyStoredImport(game: string, options: LegacyStorageOptions & {
  protocol: string;
  fallbackGameData?: unknown;
  currentRevision?: string | null;
  install(parsed: ParsedPackageZip): Promise<unknown>;
  /** Must return a copy when enriching state; cleanup retains its original owner. */
  prepareState?(state: LegacyStoredImportState): Promise<LegacyStoredImportState>;
  prepareParsed?(parsed: ParsedPackageZip): Promise<ParsedPackageZip>;
  /** Reject to keep every historical byte and metadata record. */
  verifyInstalled?(parsed: ParsedPackageZip, installed: unknown): Promise<void>;
}): Promise<LegacyMigrationResult>;
