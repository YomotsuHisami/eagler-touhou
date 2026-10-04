import type { GameId } from "./product-catalog.mjs";

export interface PackageFileDeclaration {
  revision: string;
  source: string;
  target: string;
  bytes?: number;
  sha256?: string;
  [key: string]: unknown;
}

export interface PackageRuntimeDeclaration {
  type: string;
  entry: string;
  playerProtocol: string;
  bootstrap?: string[];
  [key: string]: unknown;
}

export interface PackageComponentEntry {
  id: string;
  file: string;
  title?: string;
  [key: string]: unknown;
}

export interface PackageComponentDeclaration {
  type: string;
  files?: string[];
  entries?: PackageComponentEntry[];
  [key: string]: unknown;
}

export interface PackageDescriptor {
  schema: string;
  game: GameId;
  revision: string;
  files: Record<string, PackageFileDeclaration>;
  base: { files: string[]; [key: string]: unknown };
  components: Record<string, PackageComponentDeclaration>;
  runtime?: PackageRuntimeDeclaration;
  runtimes?: Record<string, PackageRuntimeDeclaration>;
  defaultRuntime?: string;
  runtimeRequirement?: {
    protocol: string;
    target: string;
    dataFile: string;
    dataLayout?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface PackageFileRef {
  objectId: string;
  revision: string;
  storageMode?: "arraybuffer";
  [key: string]: unknown;
}

export interface InstalledPackageGeneration {
  id: string;
  game: GameId;
  descriptor: PackageDescriptor;
  files: Partial<Record<string, PackageFileRef>>;
  [key: string]: unknown;
}

export interface PackageInstallation {
  game: GameId;
  source: "local" | "remote";
  currentGeneration: string | null;
  pendingGeneration: string | null;
  /** Last confirmed uninstall; cleared only by a successful new commit. */
  removedGenerationId?: string | null;
  pendingOperationId?: string | null;
  pendingWebLock?: boolean | null;
  pendingStartedAt?: number | null;
  [key: string]: unknown;
}

export interface CurrentPackageGeneration {
  installation: PackageInstallation | null;
  generation: InstalledPackageGeneration | null;
}

export interface StoredPackageObject {
  data?: ArrayBuffer;
  blob?: Blob;
  type?: string;
  bytes?: number;
  sha256?: string;
  [key: string]: unknown;
}

export interface InstalledPackageResult {
  installation: PackageInstallation;
  generation: InstalledPackageGeneration;
}
