import type {
  CurrentPackageGeneration,
  StoredPackageObject,
} from "../src/contracts/package-read-models.mjs";

export type { StoredPackageObject } from "../src/contracts/package-read-models.mjs";

export function readPackageObject(
  objectId: string,
  options?: { indexedDBFactory?: IDBFactory },
): Promise<StoredPackageObject | null>;

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
