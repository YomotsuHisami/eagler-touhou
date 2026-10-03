import {SitePanels,useSitePanels} from '../features/SitePanels';
import {UpdateAge} from '../features/UpdateAge';
import {runtimePresentationActive} from '../runtime/presentation';
import {decodedCoverAccent} from '../../src/launcher/cover-accent.mts';
import {NavLink,Outlet,Link,useLocation} from 'react-router';
import {PRODUCT_GAMES,productEnabledForBuild} from '../../src/contracts/product-catalog.mts';
import {useBrowserServices} from '../services/browser-services';
import {useEffect,useSyncExternalStore,useRef,useState} from 'react';
import styles from './library.module.css';
import {RouteTransition} from '../ui';
import {useUiText,useUiPreferences,setUiPreferences} from '../services/ui-preferences';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
const emptySubscribe=()=>()=>{};
export default function LibraryLayout(){
  const sitePanels=useSitePanels();const menuTrigger=useRef<HTMLButtonElement|null>(null);const panelOpener=useRef<HTMLElement|null>(null);const menuFocusHandoff=useRef(false);const[donationAvailable,setDonationAvailable]=useState(true);
  const openSitePanel=(panel:'donation'|'first-use',trigger:HTMLElement|null=menuTrigger.current)=>{panelOpener.current=trigger;menuFocusHandoff.current=trigger===menuTrigger.current;sitePanels.open(panel);};
  const services=useBrowserServices();const t=useUiText();const preferences=useUiPreferences();
  const runtime=useSyncExternalStore(services?.runtime.subscribe??emptySubscribe,()=>services?.runtime.getSnapshot()??null,()=>null);
  useEffect(()=>{if(services)void services.runtime.loadMetadata();},[services]);
  const location=useLocation();
  const testBuild=runtime?.metadata?.hostManifest?.shared?.testBuild===true;
  return <div className={styles.shell}>
    <header className={styles.header}>
      <div className={styles.brandBlock}><Link className={styles.brand} to="/">EAGLER<span aria-hidden="true">☯</span>TOUHOU</Link><UpdateAge/></div>
      <nav aria-label={t('ui.nav')}>
        <Link to="/settings" state={{from:location.pathname+location.search}}>{t('settings.title')}</Link>
        <button type="button" aria-pressed={preferences.lessMotion} onClick={()=>setUiPreferences({lessMotion:!preferences.lessMotion})}>{t('nav.lessMotion')}</button>
        {donationAvailable&&<button type="button" onClick={event=>openSitePanel('donation',event.currentTarget)}>捐赠</button>}
        <a href="/faq.html">{t('nav.faq')}</a>
        <a className={styles.iconLink} href="https://github.com/YomotsuHisami/eagler-touhou" target="_blank" rel="noreferrer" aria-label="GitHub"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.28-5.27-5.68 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18A11 11 0 0 1 12 6.13c.98 0 1.95.13 2.87.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.41-2.71 5.38-5.29 5.67.42.36.79 1.06.79 2.14v3.26c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z"/></svg></a>
        <DropdownMenu.Root><DropdownMenu.Trigger ref={menuTrigger} className={styles.more} aria-label={t('nav.more')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 8 6-6 6 6M6 16l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content onCloseAutoFocus={event=>{if(menuFocusHandoff.current){event.preventDefault();menuFocusHandoff.current=false;}}} className={styles.menu} sideOffset={8} align="end">
          <DropdownMenu.Item onSelect={()=>openSitePanel('first-use')}>{t('nav.firstUseNotice')}</DropdownMenu.Item>
          <DropdownMenu.Item asChild><Link to="/lobby">{t('lobby.title')}</Link></DropdownMenu.Item>
          <DropdownMenu.CheckboxItem checked={preferences.siteNotices} onCheckedChange={siteNotices=>setUiPreferences({siteNotices})}>{t('notice.label')}<DropdownMenu.ItemIndicator>✓</DropdownMenu.ItemIndicator></DropdownMenu.CheckboxItem>
          <DropdownMenu.CheckboxItem checked={preferences.diagnostics===true} onCheckedChange={diagnostics=>setUiPreferences({diagnostics})}>{t('diagnostics.toggle')}<DropdownMenu.ItemIndicator>✓</DropdownMenu.ItemIndicator></DropdownMenu.CheckboxItem>
          <DropdownMenu.RadioGroup value={preferences.locale} onValueChange={locale=>{if(locale==='en'||locale==='zh-CN')setUiPreferences({locale});}} aria-label={t('ui.language')}><DropdownMenu.RadioItem value="zh-CN">简体中文<DropdownMenu.ItemIndicator>✓</DropdownMenu.ItemIndicator></DropdownMenu.RadioItem><DropdownMenu.RadioItem value="en">English<DropdownMenu.ItemIndicator>✓</DropdownMenu.ItemIndicator></DropdownMenu.RadioItem></DropdownMenu.RadioGroup>
          <DropdownMenu.Item asChild><a href="/about.html">{t('nav.about')}</a></DropdownMenu.Item>
        </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
      </nav>
    </header>
    <div className={styles.directory}>
      <aside className={styles.library} aria-label={t('ui.library')}><header className={styles.railHeading}><h2>{t('library.directory')}</h2><span>TOUHOU PROJECT</span></header><nav className={styles.rail} aria-label={t('ui.library')}>
        <NavLink to="/" end className={({isActive})=>`${styles.siteCard} ${isActive?styles.selected:''}`}><span className={styles.siteWordmark}><span>EAGLER</span><span>TOUHOU</span></span><small>Eagler Touhou</small></NavLink>
        {Object.entries(PRODUCT_GAMES).filter(([id])=>productEnabledForBuild(id,testBuild)).map(([id,game])=><NavLink key={id} to={`/games/${id}`} state={{from:location.pathname}} className={({isActive})=>`${styles.card} ${isActive?styles.selected:''}`}>
          <img src={`/assets/${('cardArtwork' in game ? game.cardArtwork : '')}`} alt="" loading="lazy" decoding="async" onLoad={event=>{const image=event.currentTarget;const accent=decodedCoverAccent(image);if(accent)image.parentElement?.style.setProperty('--cover-accent',accent);}} onError={event=>{event.currentTarget.style.visibility='hidden';}}/>
          <span className={styles.cardText}><small>{game.number}</small><strong>{game.title}</strong><span>{game.subtitle}</span></span>
        </NavLink>)}
      </nav></aside>
      <main className={styles.content}><RouteTransition routeKey={location.pathname.split('/').slice(0,3).join('/')}><Outlet/></RouteTransition></main>
    </div>
    <footer className={styles.siteFooter}><div className={styles.footerDivider}/><div>
      <p>由 <a href="https://b23.tv/x3IIf0k" target="_blank" rel="noreferrer">Ritosa</a>、<a href="https://github.com/Goan114" target="_blank" rel="noreferrer">Goan114</a>、<a href="https://b23.tv/kmhLOQb" target="_blank" rel="noreferrer">Grass1337</a>、<a href="https://github.com/Patchouli-CN" target="_blank" rel="noreferrer">Patchouli-CN</a>、<a href="https://b23.tv/WOQhahY" target="_blank" rel="noreferrer">SteinsGateON</a> 倾力开发。</p>
      <p>使用 GPL-3.0 license。<a href="https://github.com/YomotsuHisami/eagler-touhou" target="_blank" rel="noreferrer">Github 仓库</a><i aria-hidden="true">/</i><a href="https://qm.qq.com/q/eeUrxIltug" target="_blank" rel="noreferrer">QQ 群</a><i aria-hidden="true">/</i>{donationAvailable&&<button type="button" onClick={event=>openSitePanel('donation',event.currentTarget)}>捐赠以支持服务器运行</button>}</p>
    </div></footer>
    <SitePanels panel={sitePanels.panel} onClose={()=>void sitePanels.close()} returnFocusRef={panelOpener} onDonationUnavailable={()=>{setDonationAvailable(false);void sitePanels.close();}} runtimeActive={runtimePresentationActive(runtime??null)}/>
  </div>;
}

/** A route failure must not tear down Root's active Runtime or its save owner. */
export function ErrorBoundary(){return <main className={styles.shell}><h1>页面暂时无法打开</h1><p>正在运行的游戏仍然保留，可以返回游戏库后重试。</p><Link to="/">返回游戏库</Link></main>;}
