import { readPackageObject } from "./package-store.mjs";

function packageDataFileId(generation) {
  const descriptor = generation?.descriptor;
  if (!descriptor?.files || !generation?.files) throw new Error("Package generation is unavailable");
  const declared = descriptor.runtimeRequirement?.dataFile;
  if (declared && descriptor.files[declared] && generation.files[declared]?.objectId) return declared;
  if (descriptor.files["game-data"] && generation.files["game-data"]?.objectId) return "game-data";
  const matches = Object.entries(descriptor.files)
    .filter(([fileId, declaration]) => generation.files[fileId]?.objectId && /\.data$/i.test(String(declaration?.target || "")))
    .map(([fileId]) => fileId);
  if (matches.length !== 1) throw new Error("Package generation must contain exactly one installed DATA file");
  return matches[0];
}

export async function readManagedRuntimeData(generation) {
  const fileId = packageDataFileId(generation);
  const declaration = generation.descriptor.files[fileId];
  const objectId = generation.files[fileId].objectId;
  const stored = await readPackageObject(objectId);
  if (!stored) throw new Error("Installed game DATA is missing");
  const buffer = stored.data instanceof ArrayBuffer
    ? stored.data.slice(0)
    : stored.blob instanceof Blob
      ? await stored.blob.arrayBuffer()
      : null;
  if (!(buffer instanceof ArrayBuffer)) throw new Error("Installed game DATA cannot be read");
  const expectedBytes = Number(declaration.bytes) || 0;
  if (expectedBytes > 0 && buffer.byteLength !== expectedBytes) {
    throw new Error(`Installed game DATA size mismatch: ${buffer.byteLength}/${expectedBytes}`);
  }
  return { buffer, bytes: buffer.byteLength, fileId };
}

export async function readManagedRuntimeResource(generation, fileId) {
  const declaration = generation?.descriptor?.files?.[fileId];
  const objectId = generation?.files?.[fileId]?.objectId;
  if (!declaration || !objectId) return null;
  const stored = await readPackageObject(objectId);
  if (!stored) return null;
  const buffer = stored.data instanceof ArrayBuffer
    ? stored.data.slice(0)
    : stored.blob instanceof Blob
      ? await stored.blob.arrayBuffer()
      : null;
  if (!(buffer instanceof ArrayBuffer)) return null;
  const expectedBytes = Number(declaration.bytes) || 0;
  if (expectedBytes > 0 && buffer.byteLength !== expectedBytes) {
    throw new Error(`${fileId}: installed resource size mismatch`);
  }
  return { buffer, bytes: buffer.byteLength, fileId, path: declaration.target };
}

export function managedRuntimeUrl(runtimeUrl, generation, runtimeVariant = "normal", baseUrl = globalThis.location?.href) {
  if (typeof runtimeUrl !== "string" || !runtimeUrl) throw new Error("Managed Runtime URL is unavailable");
  if (!generation?.id || !generation?.game) throw new Error("Package generation is unavailable");
  const url = new URL(runtimeUrl, baseUrl || "https://runtime.invalid/");
  url.searchParams.set("hosted", "1");
  url.searchParams.set("managedData", "1");
  url.searchParams.set("gameGeneration", generation.id);
  url.searchParams.set("runtimeVariant", runtimeVariant || "normal");
  return url.href;
}
