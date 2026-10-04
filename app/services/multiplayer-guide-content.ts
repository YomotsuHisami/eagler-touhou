/** Pure grouping of the same generated, sanitized guide used by Notices. */
import {MULTIPLAYER_GUIDE_GAMES, MULTIPLAYER_GUIDE_COMMON_HEADING, DEFAULT_MULTIPLAYER_GUIDE_GAME} from '../../src/launcher/multiplayer-guide.mts';
import type {PackagedContentNode} from './notices.client';
export {MULTIPLAYER_GUIDE_GAMES, DEFAULT_MULTIPLAYER_GUIDE_GAME};
const text = (node: PackagedContentNode): string => node.kind === 'text' ? node.text : node.children.map(text).join('');
const heading = (node: PackagedContentNode) => text(node).replace(/\s+/g, ' ').trim();
export function multiplayerGuideGroups(nodes: ReadonlyArray<PackagedContentNode>) {
  const groups = new Map<string, PackagedContentNode[]>(), intro: PackagedContentNode[] = [];
  let current = intro;
  for (const node of nodes) {
    if (node.kind === 'element' && node.tag === 'h2') {current = [];groups.set(heading(node), current);}
    else if (!(node.kind === 'element' && node.tag === 'h1')) current.push(node);
  }
  const common = groups.get(MULTIPLAYER_GUIDE_COMMON_HEADING);
  if (!common) return null;
  return Object.freeze({intro: Object.freeze(intro), common: Object.freeze(common),
    games: Object.freeze(MULTIPLAYER_GUIDE_GAMES.map(game => Object.freeze({...game,
      nodes: Object.freeze((groups.get(`${game.short} ${game.title}`) ?? []).filter(node => !(node.kind === 'element' && node.tag === 'h3' && heading(node) === '本作特有规则'))),
    }))),
  });
}
export function multiplayerGuideGameId(requested: string | null | undefined): string {
  return MULTIPLAYER_GUIDE_GAMES.some(game => game.id === requested) ? requested! : DEFAULT_MULTIPLAYER_GUIDE_GAME;
}
