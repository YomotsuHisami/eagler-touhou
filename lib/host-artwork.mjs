import { PRODUCT_GAMES } from "./contracts/product-catalog.mjs";
import { HOST_SITE_ARTWORK_FILES } from "./frontend-static-manifest.mjs";

/** Host ownership is independent of the selected browser entrypoint. */
export function hostArtworkFiles(games) {
  const files = games.flatMap(game => {
    const product = PRODUCT_GAMES[game];
    if (!product) throw new Error(`unknown artwork product: ${game}`);
    return product.cardArtwork ? [product.cardArtwork] : [];
  });
  return Object.freeze([...files, ...HOST_SITE_ARTWORK_FILES]);
}
