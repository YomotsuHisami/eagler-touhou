import {PRODUCT_GAMES, gameIdForProduct, isMultiplayerProductId, type ProductId, type GameId} from '../../../src/contracts/product-catalog.mts';

/** Host/publication decides membership and URLs before constructing this view data. */
export interface LibraryProduct {
  id: ProductId;
  gameId: GameId;
  title: string;
  subtitle: string;
  number: string;
  multiplayer: boolean;
  artwork: string | null;
  href: string;
  hidden?: boolean;
  presentation?: {positionPercent: number; artBrightness: number; artSaturation: number; glowBrightness: number; glowSaturation: number};
  adaptationNotice: boolean;
  sourceRepository: string;
  credit?: {name: string; url: string};
}

/** Same catalog fields as lib/launcher-optimization.mjs; no copied product list. */
export function createLibraryProducts(ids: readonly ProductId[], assetUrl: (path: string) => string, hrefForProduct: (id: ProductId) => string): LibraryProduct[] {
  return ids.map(id => {
    const gameId = gameIdForProduct(id), game = PRODUCT_GAMES[gameId], support = game.support;
    return {
      id, gameId, title: game.title, subtitle: game.subtitle, number: game.number,
      multiplayer: isMultiplayerProductId(id),
      artwork: 'cardArtwork' in game && game.cardArtwork ? assetUrl(`assets/${game.cardArtwork}`) : null,
      href: hrefForProduct(id),
      presentation: 'cardPresentation' in game ? game.cardPresentation : undefined,
      adaptationNotice: 'adaptationNotice' in support && support.adaptationNotice === 'early-test',
      sourceRepository: support.sourceRepository,
      credit: 'credit' in support ? support.credit : undefined,
    };
  });
}
