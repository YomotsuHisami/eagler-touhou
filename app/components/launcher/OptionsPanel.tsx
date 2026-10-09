import {useRef, type ReactNode} from 'react';
import {useOptionsViewport} from './use-options-viewport';
import {useLocale} from '../../i18n';
import type {LibraryProduct} from './products';

export interface OptionsPanelProps {
  product: LibraryProduct;
  open: boolean;
  onBack: () => void;
  children: ReactNode;
  /** Preserve the original MP link only when that product is actually published. */
  lobbyHref?: string;
  embeddedInLobby?: boolean;
  assetUrl: (path: string) => string;
}
/** Main index.html354–365 shell; body is the shared SettingsBody, never a copy. */
export function OptionsPanel({product, open, onBack, children, lobbyHref, embeddedInLobby = false, assetUrl}: OptionsPanelProps) {
  const {t} = useLocale();
  const panel = useRef<HTMLElement>(null); useOptionsViewport(panel);
  const credit = product.credit ?? {name: t('gameNotice.credit'), url: 'https://b23.tv/WOQhahY'};
  return <aside ref={panel} className={`tools${open ? ' is-open' : ''}${product.multiplayer ? ' mp-mode' : ''}`} aria-hidden={!open}>
    <div className="tools-head">
      <img className="options-cover" id="optionsCover" src={product.artwork ?? undefined} hidden={!product.artwork} alt="" decoding="async"/>
      <button className="library-back" id="libraryBack" type="button" aria-label={t('library.back')} onClick={onBack}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 5-7 7 7 7M3 12h18"/></svg></button>
      <div className="tools-title"><div className="game-id visually-hidden" id="gameId" data-game={product.gameId}>{product.gameId.toUpperCase()}{product.multiplayer ? ' MP' : ''}</div><h3 className="visually-hidden" id="gameTitle">{product.title}</h3><span className="options-number" id="optionsNumber" aria-hidden="true">{product.number}</span><div className="options-subtitle-line"><span className="options-subtitle" id="optionsSubtitle">{product.subtitle}</span><span className="mp-title-badge" id="mpTitleBadge" hidden={!product.multiplayer}>MULTIPLAYER</span></div></div>
    </div>
    <div className="options-scroll">
      {product.multiplayer && !embeddedInLobby && lobbyHref && <a className="options-lobby-link" id="optionsLobbyLink" href={lobbyHref} aria-label={`${product.title} · ${t('lobby.title')}`}><img src={assetUrl('assets/room-users.svg')} alt="" width="20" height="20"/><span>{t('lobby.title')}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></a>}
      {!product.multiplayer && product.adaptationNotice && <details className="tools-callout" id="gameNoticeCallout" aria-labelledby="gameNoticeCalloutTitle">
        <summary className="tools-callout-title" id="gameNoticeCalloutTitle"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z"/></svg><span>{t('options.adaptation')}</span></summary>
        <p>{t('gameNotice.earlyTest')}</p>
        <p className="tools-callout-line"><span>{t('gameNotice.creditBefore')}</span><a className="site-notice-brand" id="gameNoticeCredit" href={credit.url} target="_blank" rel="noopener noreferrer"><span className="site-notice-brand-icon"><img src={assetUrl('assets/notice-bilibili.svg')} alt="" decoding="async"/></span><span id="gameNoticeCreditName">{credit.name}</span></a><span>{t('gameNotice.creditAfter')}</span></p>
        <p className="tools-callout-line"><a className="site-notice-brand" id="gameNoticeRepo" href={product.sourceRepository} target="_blank" rel="noopener noreferrer"><span className="site-notice-brand-icon"><img src={assetUrl('assets/notice-github.svg')} alt="" decoding="async"/></span><span>{t('gameNotice.repo')}</span></a></p>
      </details>}
      {children}
    </div>
  </aside>;
}
