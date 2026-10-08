import {useState} from 'react';
import type {LibraryProduct} from './library-products';

/** Rails and panel headers share both the Host image and missing-file fallback. */
export function ProductArtwork({product, eager = false, onLoad}: {product: LibraryProduct; eager?: boolean; onLoad?: (image: HTMLImageElement) => void}) {
  const [failed, setFailed] = useState<readonly string[]>([]);
  const source = [product.artwork, product.fallbackArtwork].find(value => value && !failed.includes(value));
  if (!source) return null;
  return <img key={source} src={source} alt="" draggable={false} width={640} height={480}
    decoding="async" loading={eager ? 'eager' : 'lazy'} className="size-full object-cover"
    style={{objectPosition: `${product.artworkPosition ?? 50}% center`}}
    onLoad={event => onLoad?.(event.currentTarget)}
    onError={() => setFailed(previous => [...previous, source])}/>;
}
