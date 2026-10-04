/** Retained, validated publication authority. This is metadata only: Package
 * objects/writes and executable verification remain with their existing owners.
 * The cache survives shell replacement and is scoped to the exact Host URL.
 */
import {HOST_MANIFEST_FILE, validateHostManifest, type HostManifest} from '../../src/contracts/host-manifest.mts';
import {RUNTIME_MANIFEST_FILE} from '../../src/contracts/runtime-generations.mts';
import {sha256Hex} from '../../src/launcher/sha256.mts';
export type HostMetadataCache = Pick<CacheStorage, 'open'>;
const schema = 'eagler-touhou/retained-host/1';
export function hostMetadataAddress(baseUrl: string) {return new URL(HOST_MANIFEST_FILE, baseUrl).href;}
async function cache(baseUrl: string, storage?: HostMetadataCache | null) {
  const owner = storage === undefined ? globalThis.caches : storage;
  return owner?.open(`eagler-touhou-host-metadata-v1-${encodeURIComponent(baseUrl)}`) ?? null;
}
export async function retainPublishedHost(baseUrl: string, input: HostManifest, body: string, storage?: HostMetadataCache | null) {
  const host = validateHostManifest(input);
  // Mutable development sources never acquire offline publication authority.
  if (host.profile === 'web-development' || host.shared.runtimeManifest !== RUNTIME_MANIFEST_FILE) return;
  try {
    await (await cache(baseUrl, storage))?.put(hostMetadataAddress(baseUrl), new Response(JSON.stringify({schema, url: hostMetadataAddress(baseUrl), body, sha256: await sha256Hex(new TextEncoder().encode(body))}),
      {headers: {'content-type': 'application/json'}}));
  } catch { /* Storage denial does not break an online launch. */ }
}
export async function readRetainedPublishedHost(baseUrl: string, publication: unknown, storage?: HostMetadataCache | null): Promise<HostManifest | null> {
  try {
    const marker = publication as {schema?: string; mountPath?: string; hostManifest?: {path?: string; sha256?: string; profile?: string}};
    if (marker?.schema !== 'eagler-touhou/ui-publication/1' || marker.mountPath !== new URL(baseUrl).pathname ||
        marker.hostManifest?.path !== HOST_MANIFEST_FILE || !/^[a-f0-9]{64}$/.test(marker.hostManifest.sha256 ?? '')) return null;
    const response = await (await cache(baseUrl, storage))?.match(hostMetadataAddress(baseUrl));
    if (!response?.ok) return null;
    const retained = await response.json();
    if (retained?.schema !== schema || retained.url !== hostMetadataAddress(baseUrl) || typeof retained.body !== 'string' ||
        retained.sha256 !== marker.hostManifest.sha256 || await sha256Hex(new TextEncoder().encode(retained.body)) !== retained.sha256) return null;
    const host = validateHostManifest(JSON.parse(retained.body));
    return host.profile === marker.hostManifest.profile && host.profile !== 'web-development' && host.shared.runtimeManifest === RUNTIME_MANIFEST_FILE ? host : null;
  } catch {return null;}
}
