import {useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import {useLocale} from '../../i18n';
import {bindLibraryRail} from './library-rail';
import type {LibraryProduct} from './products';

export interface LibraryCardsProps {
  products: readonly LibraryProduct[];
  selectedProduct?: string;
  openedProduct?: string;
  onSelect: (productId: string) => void;
  onActivate: (productId: string) => void;
  /** Filtering a directory selects a cover before activating its options. */
  selectBeforeActivate?: boolean;
  variant: 'singleplayer' | 'multiplayer' | 'lobby';
  lobbyLink?: ReactNode;
  inert?: boolean;
  /** Original published HTML before the document-lived session is attached. */
  interactive?: boolean;
}

function titleMarkup(title: string) {
  return title.startsWith('東方') && title.length > 2
    ? <><span>東方</span><wbr/><span>{title.slice(2)}</span></>
    : <span>{title}</span>;
}
function presentationStyle(product: LibraryProduct): CSSProperties | undefined {
  const p = product.presentation;
  return p ? {'--art-position': `${p.positionPercent}%`, '--card-art-brightness': p.artBrightness,
    '--card-art-saturation': p.artSaturation, '--card-glow-brightness': p.glowBrightness,
    '--card-glow-saturation': p.glowSaturation} as CSSProperties : undefined;
}

/** One original rail for the library and directory; no Router/history owner. */
export function LibraryCards({products, selectedProduct, openedProduct, onSelect, onActivate, selectBeforeActivate = false, variant, lobbyLink, inert = false, interactive = true}: LibraryCardsProps) {
  const {t} = useLocale();
  const shelf = useRef<HTMLElement>(null), controller = useRef<ReturnType<typeof bindLibraryRail> | null>(null);
  const callbacks = useRef({onSelect, onActivate, selectBeforeActivate, products}); callbacks.current = {onSelect, onActivate, selectBeforeActivate, products};
  const [failedArt, setFailedArt] = useState<ReadonlySet<string>>(() => new Set());
  const [preview, setPreview] = useState(() => interactive ? products.some(p => p.id === selectedProduct && !p.hidden) ? selectedProduct : products.find(p => !p.hidden)?.id : undefined);
  const members = products.map(p => `${p.id}:${!!p.hidden}`).join('|');
  const directory = variant === 'lobby';
  const railId = directory ? 'lobbyGameRail' : `${variant}Rail`;
  const headingId = `${variant}Heading`, minimapLabelId = `${variant}MinimapLabel`;
  useLayoutEffect(() => {
    if (!interactive || !shelf.current) return;
    let ready = false;
    const current = bindLibraryRail(shelf.current, {
      initialProduct: selectedProduct ?? preview,
      openOnFirstClick: id => !callbacks.current.selectBeforeActivate && callbacks.current.products.some(p => p.id === id && p.multiplayer),
      onSelectionChange: id => {setPreview(id); if (ready) callbacks.current.onSelect(id);},
    });
    ready = true; controller.current = current;
    return () => {current.dispose(); if (controller.current === current) controller.current = null;};
    // Rebind only when actual card membership/visibility changes.
    // Callback and external-selection updates do not recreate pointer ownership.
  }, [members, interactive]);
  useLayoutEffect(() => {
    if (selectedProduct && products.some(p => p.id === selectedProduct && !p.hidden) && controller.current?.getSelectedProduct() !== selectedProduct) {
      controller.current?.selectProduct(selectedProduct);
    }
  }, [selectedProduct, members]);
  const cards = products.map((product, index) => {
    const classes = ['game', `game-${product.gameId}`, product.multiplayer ? `game-${product.id} game-multiplayer` : '',
      interactive && (!product.artwork || failedArt.has(product.id)) ? 'card-art-missing' : '', preview === product.id ? 'nav-preview' : '', openedProduct === product.id ? 'selected' : ''].filter(Boolean).join(' ');
    return <a key={product.id} className={classes} data-game={product.gameId} data-product={product.multiplayer ? product.id : undefined}
      href={product.href} aria-current={interactive ? openedProduct === product.id ? 'page' : 'false' : undefined} style={presentationStyle(product)} hidden={product.hidden} draggable={false}
      onClick={interactive ? event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); callbacks.current.onActivate(product.id);
      } : undefined}>
      {product.artwork && <><span className="card-art" aria-hidden="true"><img className="card-art-image" src={product.artwork} onError={() => setFailedArt(previous => new Set(previous).add(product.id))} alt="" width={index === 0 && !product.multiplayer ? 640 : undefined} height={index === 0 && !product.multiplayer ? 480 : undefined} fetchPriority={index === 0 && !product.multiplayer ? 'high' : undefined} draggable={false}/><span className="card-art-shade"/></span><span className="card-glow" aria-hidden="true"><img className="card-art-image" src={product.artwork} onError={() => setFailedArt(previous => new Set(previous).add(product.id))} alt="" draggable={false}/></span></>}
      {product.multiplayer && <span className="mp-card-mark" aria-hidden="true">MULTIPLAYER</span>}
      <div className="no"><span className="no-label">{product.number}{product.multiplayer && <span className="no-mp">MP</span>}</span></div>
      <div className="game-copy"><h2><span className="game-title">{titleMarkup(product.title)}</span>{product.multiplayer && <> <span className="mp-game-title-badge" aria-hidden="true">MULTIPLAYER</span></>}</h2><small>{product.subtitle}</small></div>
      <span className="rail-title"><strong>{product.title}</strong> ~ {product.multiplayer ? 'Multiplayer' : product.subtitle}</span>
    </a>;
  });
  const index = <div className="minimap-dock">{products.map(product => {
    return <button key={product.id} className={`minimap-toggle${preview === product.id ? ' is-current' : ''}`} type="button" data-minimap-preview={product.id}
      aria-label={product.title} aria-current={interactive ? preview === product.id : undefined}
      aria-controls={railId} aria-describedby={minimapLabelId} hidden={product.hidden}>
      <span className="minimap-index" aria-hidden="true">{product.number}</span>
    </button>;
  })}</div>;
  // Shared cards retain Launcher font, focus and reduced-motion rules even
  // when their surrounding page owns the directory's room controls.
  return <section ref={shelf} className="game-shelf" data-launcher-document="" data-shelf={directory ? undefined : variant} aria-labelledby={directory ? undefined : headingId} hidden={interactive && !products.some(p => !p.hidden)} inert={inert}>
    {!directory && <header className="shelf-heading"><h2 id={headingId}>{t(variant === 'multiplayer' ? 'library.multiplayer' : 'library.singleplayer')}</h2><span className="shelf-caption">{t(variant === 'multiplayer' ? 'library.multiplayerHint' : 'library.singleplayerHint')}</span>{lobbyLink}</header>}
    <div className="game-rail" id={railId} role={directory ? undefined : 'group'} aria-labelledby={directory ? undefined : headingId}>{cards}</div>
    {directory ? <nav className="shelf-minimap" id="filters" aria-label={t('lobby.game')}>{interactive || products.length ? <>{index}<span className="sr-only" id={minimapLabelId}>{t('library.holdNav')}</span></> : null}</nav>
      : <div className="shelf-minimap">{index}<span className="sr-only" id={minimapLabelId}>{t('library.holdNav')}</span></div>}
  </section>;
}
