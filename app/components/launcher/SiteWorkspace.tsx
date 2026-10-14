import {Fragment} from 'react';
import {useLocale} from '../../i18n';
import type {SiteNoticeLine} from '../notices/site-notice-source';
import {SiteNoticeBrandIcon} from '../notices/SiteNoticeBrandIcon';
import {CharacterPortraits} from './CharacterPortraits';
import type {CharacterArtId} from '../../../src/contracts/character-art.mts';

const HOME_PORTRAITS: readonly CharacterArtId[] = ['reimu', 'marisa'];

/** The document notice owner supplies its existing parsed announcement. */
export function SiteWorkspace({assetUrl, noticeLines = []}: {assetUrl(path: string): string; noticeLines?: readonly SiteNoticeLine[]; interactive?: boolean}) {
  const {t} = useLocale();
  const displayedLines = noticeLines;
  const status = !displayedLines.length ? t('workspace.welcome') : '';
  return <aside className="tools workspace-panel site-workspace" aria-labelledby="siteInfoTitle">
    <section className="site-info" id="siteInfo"><header className="site-info-heading"><div><p className="site-info-wordmark">EAGLER TOUHOU</p><h2 id="siteInfoTitle" tabIndex={-1}>{t('notice.aria')}</h2></div></header>
      <p className="site-info-status" role="status" hidden={!status}>{status}</p>
      <div className="site-info-content">{displayedLines.map((line, index) => <p key={index}>{line.map((segment, item) => segment.type === 'text' ? <Fragment key={item}>{segment.text}</Fragment> : <a key={item} className="site-notice-brand" href={segment.resolvedHref} target={segment.external ? '_blank' : undefined} rel={segment.external ? 'noopener noreferrer' : undefined}>{segment.asset && <SiteNoticeBrandIcon src={assetUrl(segment.asset)}/>}<span>{segment.label}</span></a>)}</p>)}</div>
      <CharacterPortraits characters={HOME_PORTRAITS} assetUrl={assetUrl}/>
    </section>
  </aside>;
}
