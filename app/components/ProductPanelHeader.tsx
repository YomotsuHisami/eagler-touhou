import type {RefObject} from 'react';
import {currentLibraryProducts, publishedLibraryProducts} from './library-products';
import {useAppShell} from './AppShellProvider';
import {useLocale} from './LocaleProvider';
import {PRODUCT_GAMES, gameIdForProduct, isMultiplayerProductId, type ProductId} from '../../src/contracts/product-catalog.mts';

/** One cover/number/title treatment for library settings and room settings.
 * Artwork comes from the same attested publication catalog as the card rail. */
export function ProductPanelHeader({productId, onBack, backLabel, backRef}: {
  productId: ProductId; onBack(): void; backLabel?: string; backRef?: RefObject<HTMLButtonElement | null>;
}) {
  const {t} = useLocale(), publication = useAppShell().snapshot?.gate;
  const product = publishedLibraryProducts(currentLibraryProducts, publication).find(item => item.id === productId);
  const game = PRODUCT_GAMES[gameIdForProduct(productId)];
  return <header className="library-panel-header" data-product-cover={productId} data-multiplayer={isMultiplayerProductId(productId)}>
    <div className="main-cover-fallback absolute inset-0 -z-20" aria-hidden="true">
      {product?.artwork && <img src={product.artwork} alt="" className="size-full object-cover" style={{objectPosition: `${product.artworkPosition ?? 50}% center`}}/>}
    </div>
    <button ref={backRef} type="button" className="library-panel-back" onClick={onBack} aria-label={backLabel ?? t('library.back')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg>
    </button>
    <div className="library-panel-title">
      <h1 lang="ja" className="sr-only">{game.title}</h1>
      <span className="library-panel-number" aria-hidden="true">{game.number}</span>
      <p className="library-panel-subtitle" lang="en">{game.subtitle}</p>
    </div>
  </header>;
}
