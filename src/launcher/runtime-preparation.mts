import { readPackageObject, type StoredPackageObject } from "../../package/package-store.mjs";
import type { InstalledPackageGeneration } from "../contracts/package-read-models.mjs";

type ReadObject = (objectId: string) => Promise<StoredPackageObject | null>;

interface ReadOptions {
  readObject?: ReadObject;
}

function packageDataFileId(generation: InstalledPackageGeneration) {
  const descriptor = generation?.descriptor;
  if (!descriptor?.files || !generation?.files) throw new Error("Package generation is unavailable");
  const declared = descriptor.runtimeRequirement?.dataFile;
  if (declared && descriptor.files[declared] && generation.files[declared]?.objectId) return declared;
  if (descriptor.files["game-data"] && generation.files["game-data"]?.objectId) return "game-data";
  const matches = Object.entries(descriptor.files)
    .filter(([fileId, declaration]) => generation.files?.[fileId]?.objectId && /\.data$/i.test(String(declaration?.target || "")))
    .map(([fileId]) => fileId);
  if (matches.length !== 1) throw new Error("Package generation must contain exactly one installed DATA file");
  const [fileId] = matches;
  if (!fileId) throw new Error("Package generation DATA file resolution failed");
  return fileId;
}

async function storedObjectBuffer(stored: StoredPackageObject | null) {
  if (!stored) return null;
  if (stored.data instanceof ArrayBuffer) return stored.data.slice(0);
  if (stored.blob instanceof Blob) return stored.blob.arrayBuffer();
  return null;
}

export async function readManagedRuntimeData(
  generation: InstalledPackageGeneration,
  { readObject = readPackageObject }: ReadOptions = {},
) {
  const fileId = packageDataFileId(generation);
  const declaration = generation.descriptor.files[fileId];
  const fileRef = generation.files[fileId];
  if (!declaration || !fileRef?.objectId) throw new Error("Installed game DATA is missing");
  const objectId = fileRef.objectId;
  const stored = await readObject(objectId);
  if (!stored) throw new Error("Installed game DATA is missing");
  const buffer = await storedObjectBuffer(stored);
  if (!(buffer instanceof ArrayBuffer)) throw new Error("Installed game DATA cannot be read");
  if (declaration.bytes != null && buffer.byteLength !== Number(declaration.bytes)) {
    throw new Error(`Installed game DATA size mismatch: ${buffer.byteLength}/${declaration.bytes}`);
  }
  return { buffer, bytes: buffer.byteLength, fileId };
}

export async function readManagedRuntimeResource(
  generation: InstalledPackageGeneration,
  fileId: string,
  { readObject = readPackageObject }: ReadOptions = {},
) {
  const declaration = generation?.descriptor?.files?.[fileId];
  const objectId = generation?.files?.[fileId]?.objectId;
  if (!declaration || !objectId) return null;
  const stored = await readObject(objectId);
  if (!stored) return null;
  const buffer = await storedObjectBuffer(stored);
  if (!(buffer instanceof ArrayBuffer)) return null;
  if (declaration.bytes != null && buffer.byteLength !== Number(declaration.bytes)) {
    throw new Error(`${fileId}: installed resource size mismatch`);
  }
  return { buffer, bytes: buffer.byteLength, fileId, path: declaration.target };
}

export function managedRuntimeUrl(
  runtimeUrl: string,
  generation: InstalledPackageGeneration,
  runtimeVariant = "normal",
  baseUrl = globalThis.location?.href,
) {
  if (typeof runtimeUrl !== "string" || !runtimeUrl) throw new Error("Managed Runtime URL is unavailable");
  if (!generation?.id || !generation?.game) throw new Error("Package generation is unavailable");
  const url = new URL(runtimeUrl, baseUrl || "https://runtime.invalid/");
  url.searchParams.set("hosted", "1");
  url.searchParams.set("managedData", "1");
  url.searchParams.set("gameGeneration", generation.id);
  url.searchParams.set("runtimeVariant", runtimeVariant || "normal");
  return url.href;
}
