import { parseStoredZip, verifyStoredZipEntry } from "./stored-zip.mjs";
import { validatePackageDescriptor } from "./package-descriptor.mjs";
import { packageMimeType } from "./package-store.mjs";

export const PACKAGE_ZIP_DESCRIPTOR = "package.json";

export async function parsePackageZip(blob) {
  if (!(blob instanceof Blob)) throw new Error("Package ZIP must be a Blob");
  const entries = await parseStoredZip(blob);
  const descriptorEntry = entries.get(PACKAGE_ZIP_DESCRIPTOR);
  if (!descriptorEntry) throw new Error(`Package ZIP is missing ${PACKAGE_ZIP_DESCRIPTOR}`);
  await verifyStoredZipEntry(blob, descriptorEntry);
  let descriptor;
  try {
    descriptor = JSON.parse(await blob.slice(
      descriptorEntry.dataOffset,
      descriptorEntry.dataOffset + descriptorEntry.uncompressedSize,
      "application/json"
    ).text());
  } catch (error) {
    throw new Error(`invalid Package Descriptor JSON: ${error?.message || error}`);
  }
  validatePackageDescriptor(descriptor);

  const files = new Map();
  for (const [fileId, declaration] of Object.entries(descriptor.files)) {
    const entry = entries.get(declaration.source);
    if (!entry) continue;
    await verifyStoredZipEntry(blob, entry);
    files.set(fileId, {
      fileId,
      declaration,
      blob: blob.slice(entry.dataOffset, entry.dataOffset + entry.uncompressedSize, packageMimeType(declaration.source)),
      bytes: entry.uncompressedSize,
    });
  }
  return { descriptor, files, entries };
}
