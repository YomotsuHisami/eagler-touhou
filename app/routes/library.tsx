import {NavLink,Outlet,Link,useLocation} from 'react-router';
import {PRODUCT_GAMES,productEnabledForBuild} from '../../src/contracts/product-catalog.mts';
import {useBrowserServices} from '../services/browser-services';
import {useEffect,useSyncExternalStore} from 'react';
import styles from './library.module.css';
import {RouteTransition} from '../ui';
import {useUiText} from '../services/ui-preferences';
const emptySubscribe=()=>()=>{};
export default function LibraryLayout(){
  const services=useBrowserServices();const t=useUiText();
  const runtime=useSyncExternalStore(services?.runtime.subscribe??emptySubscribe,()=>services?.runtime.getSnapshot()??null,()=>null);
  useEffect(()=>{if(services)void services.runtime.loadMetadata();},[services]);
  const location=useLocation();
  const testBuild=runtime?.metadata?.hostManifest?.shared?.testBuild===true;
  return <div className={styles.shell}>
    <header className={styles.header}>
      <Link className={styles.brand} to="/">EAGLER <span aria-hidden="true">☯</span> TOUHOU</Link>
      <nav aria-label={t('ui.nav')}><Link to="/lobby">{t('lobby.title')}</Link><a href="/faq.html">{t('nav.faq')}</a><a href="/about.html">{t('nav.about')}</a><Link to="/settings" state={{from:location.pathname+location.search}}>{t('settings.title')}</Link><a href="https://github.com/YomotsuHisami/eagler-touhou" target="_blank" rel="noreferrer">GitHub</a></nav>
    </header>
    <div className={styles.directory}>
      <aside className={styles.rail} aria-label={t('ui.library')}>
        <NavLink to="/" end className={({isActive})=>`${styles.siteCard} ${isActive?styles.selected:''}`}>EAGLER TOUHOU<small>{t('ui.homeHint')}</small></NavLink>
        {Object.entries(PRODUCT_GAMES).filter(([id])=>productEnabledForBuild(id,testBuild)).map(([id,game])=><NavLink key={id} to={`/games/${id}`} state={{from:location.pathname}} className={({isActive})=>`${styles.card} ${isActive?styles.selected:''}`}>
          <img src={`/assets/${('cardArtwork' in game ? game.cardArtwork : '')}`} alt="" loading="lazy" decoding="async" onError={event=>{event.currentTarget.style.visibility='hidden';}}/>
          <span className={styles.cardText}><small>TOUHOU {game.number}</small><strong>{game.title}</strong><span>{game.subtitle}</span></span>
        </NavLink>)}
      </aside>
      <main className={styles.content}><RouteTransition routeKey={location.pathname.split('/').slice(0,3).join('/')}><Outlet/></RouteTransition></main>
    </div>
  </div>;
}

/** A route failure must not tear down Root's active Runtime or its save owner. */
export function ErrorBoundary(){return <main className={styles.shell}><h1>页面暂时无法打开</h1><p>正在运行的游戏仍然保留，可以返回游戏库后重试。</p><Link to="/">返回游戏库</Link></main>;}
