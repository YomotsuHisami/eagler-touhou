import {multiplayerConfigForProduct, type MultiplayerProductId} from '../../../src/contracts/product-catalog.mts';
import {characterArtForName, type CharacterArtId} from '../../../src/contracts/character-art.mts';
import {translate} from '../../i18n';
import type {UiMessageKey} from '../../../src/launcher/i18n.mts';

/** Indexes always belong to the current Runtime contract, including TH09's
 * native ordering and TH08's combined/solo entries. Prototype indexes differ. */
export function roomLoadoutArt(product: MultiplayerProductId, index: number): CharacterArtId[] {
  const config = multiplayerConfigForProduct(product)!;
  const loadout = config.loadouts[index];
  if (!loadout) return [];
  if (product === 'th09mp') {
    const nativeOrder: CharacterArtId[] = ['reimu','marisa','sakuya','youmu','reisen','cirno','lyrica','mystia','tewi','yuuka','aya','medicine','komachi','eiki','merlin','lunasa'];
    return nativeOrder[loadout.character] ? [nativeOrder[loadout.character]!] : [];
  }
  return translate('zh-CN', loadout.labelKey as UiMessageKey).split(' & ').flatMap(characterArtForName);
}
export function roomLoadoutGroups(product: MultiplayerProductId): number[][] {
  const config = multiplayerConfigForProduct(product)!;
  if (product === 'th08mp') return [[0,4,5], [1,6,7], [2,8,9], [3,10,11]];
  const groups = new Map<number, number[]>();
  config.loadouts.forEach((loadout, index) => {const group = groups.get(loadout.character) ?? []; group.push(index); groups.set(loadout.character, group);});
  return [...groups.values()];
}
