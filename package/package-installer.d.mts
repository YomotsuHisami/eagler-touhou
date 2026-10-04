import type {
  CurrentPackageGeneration,
  InstalledPackageResult,
  PackageDescriptor,
  PackageFileDeclaration,
} from "../src/contracts/package-read-models.mjs";
import type { ParsedPackageZip } from "./package-zip.mjs";

export interface PackageInstallProgress {
  completed: number;
  total: number;
  fileId: string;
  found: boolean;
  reused?: boolean;
}

export function installPackageFromAcquisition(options: {
  descriptor: PackageDescriptor;
  desiredFileIds: readonly string[] | ((current: CurrentPackageGeneration) => readonly string[] | Promise<readonly string[]>);
  source: "local" | "remote" | ((current: CurrentPackageGeneration) => "local" | "remote" | Promise<"local" | "remote">);
  acquire(fileId: string, declaration: PackageFileDeclaration): Promise<ArrayBuffer | ArrayBufferView | Blob | null>;
  reuseCurrent?: boolean;
  signal?: AbortSignal | null;
  onProgress?: ((progress: PackageInstallProgress) => void) | null;
}): Promise<InstalledPackageResult>;

export function installParsedPackageZip(
  parsed: ParsedPackageZip,
  options?: { onProgress?: ((progress: PackageInstallProgress) => void) | null },
): Promise<InstalledPackageResult>;
