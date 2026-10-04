import {resolve} from 'node:path';
import {createUiDeploymentContract} from './ui-deployment-contract.mjs';
export function normalizeUiBuildMountPath(value = '/') {
  if (typeof value !== 'string' || !/^(?:\/[A-Za-z0-9_-]+)*\/?$/.test(value) || !value.startsWith('/')) throw new Error('UI build mount requires safe absolute path segments');
  return createUiDeploymentContract({patterns:['/'],mountPath:value}).mountPath;
}
/** One build-time mount for Framework basename, Vite URLs and publication.
 * Keep distinct output directories when testing root and nested artifacts. */
export function uiBuildConfig(environment = process.env) {
  const mountPath = normalizeUiBuildMountPath(environment.EAGLER_UI_MOUNT_PATH || '/');
  const buildDirectory = environment.EAGLER_UI_BUILD_DIRECTORY || '.cache/build/ui-main';
  if (typeof buildDirectory !== 'string' || !buildDirectory.trim()) throw new Error('UI build directory is required');
  return {mountPath, buildDirectory, clientDirectory:resolve(buildDirectory,'client')};
}
