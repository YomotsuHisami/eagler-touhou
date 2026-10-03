/** Local preview only. Deliberately NOT in the host/private publication manifest. */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { CHARACTER_ART_IDS } from './contracts/character-art.mjs';
export function localCharacterAssetSource(project, path) {
  const allowed = new Set(['manifest.json', ...CHARACTER_ART_IDS.map(id => `${id}.png`)]);
  if (!path.startsWith('assets/dairi/') || !allowed.has(path.slice('assets/dairi/'.length))) return null;
  const source = resolve(project, 'private-assets/dairi', path.slice('assets/dairi/'.length));
  return existsSync(source) ? source : null;
}
