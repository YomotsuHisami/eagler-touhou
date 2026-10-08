import {PRODUCT_GAMES, PRODUCT_IDS, gameIdForProduct, productEnabledForBuild, type ProductId} from '../../src/contracts/product-catalog.mts';
import th06Artwork from '../../th06-card.webp';

export interface LibraryProduct {
  readonly id: ProductId;
  readonly number: string;
  readonly title: string;
  readonly subtitle: string;
  readonly artwork?: string;
  readonly fallbackArtwork?: string;
  readonly artworkPosition?: number;
}

// Catalog membership is a UI policy ceiling, not an assertion that a Host has
// installed or attested a working Runtime. Hidden/test-only products stay out.
export const currentLibraryProducts: readonly LibraryProduct[] = PRODUCT_IDS
  .filter(id => productEnabledForBuild(id, false))
  .map(id => {
    const gameId = gameIdForProduct(id);
    const game = PRODUCT_GAMES[gameId];
    return {
      id,
      number: game.number,
      title: game.title,
      subtitle: game.subtitle,
      // Source development serves the same catalog-owned covers as a Host.
      // Missing optional files retain the card background. Publication URLs
      // still take precedence after their marker has been validated.
      artwork: 'cardArtwork' in game ? `${import.meta.env?.BASE_URL ?? '/'}assets/${game.cardArtwork}` : undefined,
      fallbackArtwork: gameId === 'th06' ? th06Artwork : undefined,
      artworkPosition: 'cardPresentation' in game ? game.cardPresentation.positionPercent : 50,
    };
  });

/** Only attested publication membership narrows the catalog; plain source preview
 * retains its catalog sample without pretending metadata is available. */
export function publishedLibraryProducts(products: readonly LibraryProduct[], publication?: Pick<import('../services/app-shell.client').UiPublicationGate, 'products' | 'testBuild' | 'artwork'> | null): readonly LibraryProduct[] {
  return products.filter(product => productEnabledForBuild(product.id, publication?.testBuild ?? false) && (!publication || publication.products.includes(product.id))).map(product => {
    const artwork = publication?.artwork[gameIdForProduct(product.id)];
    return artwork ? {...product, artwork} : product;
  });
}
