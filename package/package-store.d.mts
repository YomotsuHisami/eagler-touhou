import type {
  CurrentPackageGeneration,
  PackageInstallation,
  StoredPackageObject,
} from "../src/contracts/package-read-models.mjs";

export type { StoredPackageObject } from "../src/contracts/package-read-models.mjs";
export const PACKAGE_OBJECTS: "objects";
export function openPackageStore(indexedDBFactory?: IDBFactory, options?: {timeoutMs?: number}): Promise<IDBDatabase>;

export function readPackageObject(
  objectId: string,
  options?: { indexedDBFactory?: IDBFactory },
): Promise<StoredPackageObject | null>;

export function readVerifiedPackageObjectBySha256(
  sha256: string,
  bytes: number,
  options?: { indexedDBFactory?: IDBFactory },
): Promise<(StoredPackageObject & { objectId: string }) | null>;

export function attestPackageObjectSha256(
  objectId: string,
  sha256: string,
  bytes: number,
  options?: { indexedDBFactory?: IDBFactory },
): Promise<string>;

export function readPackageObjectKeys(
  objectIds: string[],
  options?: { indexedDBFactory?: IDBFactory },
): Promise<Set<string>>;

export function readCurrentPackageGeneration(
  game: string,
  options?: { indexedDBFactory?: IDBFactory },
): Promise<CurrentPackageGeneration>;

export function garbageCollectPackageStore(options?: {
  indexedDBFactory?: IDBFactory;
  now?: number;
  leaseStaleMs?: number;
}): Promise<{ generationsDeleted: number; objectsDeleted: number }>;

export function retainPackageGeneration(
  game: string, generationId: string,
  options: { leaseId: string; now?: number; indexedDBFactory?: IDBFactory },
): Promise<string>;

export function releasePackageGeneration(
  leaseId: string, options?: { indexedDBFactory?: IDBFactory },
): Promise<void>;

/** Use the installer removeInstalledPackage wrapper for same-game serialization. */
export function detachCurrentPackageGeneration(game: string, options: {
  expectedGenerationId: string;
  signal?: AbortSignal | null;
  indexedDBFactory?: IDBFactory;
}): Promise<PackageInstallation>;
