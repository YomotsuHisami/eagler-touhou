import { parseStoredZip, readStoredZipEntry } from "./stored-zip.mjs";
import { validatePackageDescriptor } from "./package-descriptor.mjs";
import { packageMimeType } from "./package-store.mjs";

export const PACKAGE_ZIP_DESCRIPTOR = "package.json";
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export async function parsePackageZip(blob) {
  if (!(blob instanceof Blob)) throw new Error("Package ZIP must be a Blob");
  const entries = await parseStoredZip(blob);
  const descriptorEntry = entries.get(PACKAGE_ZIP_DESCRIPTOR);
  if (!descriptorEntry) throw new Error(`Package ZIP is missing ${PACKAGE_ZIP_DESCRIPTOR}`);
  let descriptor;
  try {
    descriptor = JSON.parse(textDecoder.decode(await readStoredZipEntry(blob, descriptorEntry)));
  } catch (error) {
    throw new Error(`invalid Package Descriptor JSON: ${error?.message || error}`);
  }
  validatePackageDescriptor(descriptor);

  const files = new Map();
  for (const [fileId, declaration] of Object.entries(descriptor.files)) {
    const entry = entries.get(declaration.source);
    if (!entry) continue;
    const payload = await readStoredZipEntry(blob, entry);
    files.set(fileId, {
      fileId,
      declaration,
      blob: new Blob([payload], { type: packageMimeType(declaration.source) }),
      bytes: payload.length,
    });
  }
  return { descriptor, files, entries };
}
