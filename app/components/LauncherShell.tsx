import {useRef, useState, type KeyboardEvent, type ReactNode} from 'react';
import {Link} from 'react-router';
import {
  PRODUCT_GAMES,
  PRODUCT_IDS,
  gameIdForProduct,
  isMultiplayerProductId,
  productEnabledForBuild,
  type ProductId,
} from '../../src/contracts/product-catalog.mts';
import th06Artwork from '../../th06-card.webp';
import donationImage from '../../public/assets/donation.webp';
import roomUsersIcon from '../../public/assets/room-users.svg';

/**
 * Visual sources: main@9899dff public/index.html masthead/footer;
 * public/styles.css immersive-library rules; lib/launcher-optimization.mjs
 * generateProductCards. This sample owns presentation only. React Router owns
 * navigation; no launcher bootstrap, Host, storage, or Runtime is imported.
 */
export interface LibraryProduct {
  readonly id: ProductId;
  readonly number: string;
  readonly title: string;
  readonly subtitle: string;
  readonly artwork?: string;
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
      // Only this cover is present in the checkout. Do not invent image URLs
      // for absent deployment assets or substitute frontend-redesign art.
      artwork: gameId === 'th06' ? th06Artwork : undefined,
      artworkPosition: 'cardPresentation' in game ? game.cardPresentation.positionPercent : 50,
    };
  });

// Main's compact masthead overrides (public/styles.css:161) are essential:
// the brand and controls share one row even on a portrait phone.
const mastheadControl = 'inline-flex min-h-[34px] min-w-0 items-center justify-center rounded-lg font-bold tracking-[.08em] text-nav transition-colors hover:bg-nav-hover hover:text-nav-ink focus-visible:bg-nav-hover focus-visible:text-nav-ink motion-reduce:transition-none library:min-h-9 library:tracking-[.17em]';
const mastheadLink = `${mastheadControl} px-1 py-0.5 library:px-3 library:py-0`;
const footerLink = 'text-paper/75 transition-colors hover:text-accent focus-visible:text-accent motion-reduce:transition-none';
const repository = 'https://github.com/YomotsuHisami/eagler-touhou';

function GitHubIcon() {
  return <svg viewBox="0 0 24 24" className="size-5 fill-current" aria-hidden="true"><path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.28-5.27-5.68 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18A11 11 0 0 1 12 6.13c.98 0 1.95.13 2.87.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.41-2.71 5.38-5.29 5.67.42.36.79 1.06.79 2.14v3.26c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z"/></svg>;
}

export function LauncherShell({children, versionLabel = 'main · 界面样本'}: {
  children: ReactNode;
  versionLabel?: string;
}) {
  return <div className="relative isolate min-h-svh">
    <div className="launcher-background pointer-events-none fixed inset-0 -z-20" aria-hidden="true"/>
    <div className="launcher-grain pointer-events-none fixed inset-0 z-50 opacity-[.045]" aria-hidden="true"/>
    <Link to="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-paper focus:px-4 focus:py-3 focus:text-ink">跳到游戏内容</Link>

    <div className="grid min-h-svh grid-rows-[auto_1fr] gap-[22px] px-[18px] pb-5 library:gap-6 library:px-[clamp(18px,3.5vw,56px)] library:pb-8">
      <header className="relative z-10 -mx-[18px] grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-b-[16px] border-b border-[#848a863d] bg-[#161716b3] px-[18px] pt-[11px] pb-2 text-[10px] tracking-[.17em] shadow-masthead max-[480px]:text-[9px] library:-mx-[clamp(18px,3.5vw,56px)] library:grid-cols-[1fr_auto_1fr] library:rounded-b-masthead library:px-[clamp(18px,3.5vw,56px)] library:pt-[max(12px,env(safe-area-inset-top))] library:pb-3.5">
        <Link to="/" aria-label="EAGLER TOUHOU 游戏库" className="relative inline-flex items-start justify-self-start pb-[8.5px] text-[7.5px] text-paper library:text-[10px]">
          <span className="font-brand leading-none">EAGLER</span>
          <span className="inline-flex min-w-[1.2em] justify-center font-brand leading-none" aria-hidden="true">☯</span>
          <span className="font-brand leading-none">TOUHOU</span>
          <span className="absolute top-[calc(100%_-_8.5px)] left-0 mt-0.5 whitespace-nowrap text-[6.5px] leading-none tracking-[.04em] text-nav/55">{versionLabel}</span>
        </Link>
        <nav aria-label="站点信息" className="col-start-2 flex min-w-0 flex-nowrap items-center justify-end justify-self-end gap-px library:col-start-3 library:gap-2">
          <Link to={donationImage} reloadDocument target="_blank" rel="noopener noreferrer" className={mastheadLink}>捐赠</Link>
          <Link to={`${repository}/blob/main/docs/FAQ.md`} target="_blank" rel="noopener noreferrer" aria-label="常见问题（查看仓库文档）" className={mastheadLink}><span className="text-center leading-[1.05]">常见<wbr/>问题</span></Link>
          <Link to={repository} target="_blank" rel="noopener noreferrer" aria-label="GitHub 仓库" className={`${mastheadControl} w-[38px] px-1 py-0.5 library:p-0`}><GitHubIcon/></Link>
          <details className="group relative">
            <summary aria-label="更多站点信息" className={`${mastheadControl} w-10 list-none px-1 py-0.5 library:p-0 [&::-webkit-details-marker]:hidden`}>
              <svg viewBox="0 0 24 24" className="size-[21px] fill-none stroke-current stroke-2 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true"><path d="m7 9 5-5 5 5M7 15l5 5 5-5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </summary>
            <div className="absolute top-[calc(100%+7px)] right-0 grid min-w-40 gap-1 rounded-[14px] border border-white/10 bg-menu p-2 shadow-menu">
              <Link to={`${repository}/blob/main/README.md`} target="_blank" rel="noopener noreferrer" className={`${mastheadLink} justify-start tracking-[.08em]`}>关于项目</Link>
              <Link to={repository} target="_blank" rel="noopener noreferrer" className={`${mastheadLink} justify-start tracking-[.08em]`}>源代码</Link>
            </div>
          </details>
        </nav>
      </header>

      <main id="main-content" tabIndex={-1} className="min-w-0 content-start focus:outline-none">{children}</main>
    </div>

    <footer className="relative grid min-w-0 justify-items-end px-[clamp(18px,3.5vw,56px)] pt-3 pb-[calc(28px+env(safe-area-inset-bottom))] text-right text-[8px] leading-[1.45] font-medium tracking-[.025em] text-nav/65">
      <div className="footer-divider mb-[7px] h-px w-[min(360px,45vw)] portrait:w-[min(280px,78vw)]" aria-hidden="true"/>
      <div className="grid gap-1.5">
        <p>由 <Link className={footerLink} to="https://b23.tv/x3IIf0k" target="_blank" rel="noopener noreferrer">Ritosa</Link>、<Link className={footerLink} to="https://github.com/Goan114" target="_blank" rel="noopener noreferrer">Goan114</Link>、<Link className={footerLink} to="https://b23.tv/kmhLOQb" target="_blank" rel="noopener noreferrer">Grass1337</Link>、<Link className={footerLink} to="https://github.com/Patchouli-CN" target="_blank" rel="noopener noreferrer">Patchouli-CN</Link>、<Link className={footerLink} to="https://b23.tv/WOQhahY" target="_blank" rel="noopener noreferrer">SteinsGateON</Link> 倾力开发。</p>
        <p>使用 GPL-3.0 license。<Link className={footerLink} to={repository} target="_blank" rel="noopener noreferrer">Github 仓库</Link><span className="mx-2 text-nav/30" aria-hidden="true">/</span><Link className={footerLink} to="https://qm.qq.com/q/eeUrxIltug" target="_blank" rel="noopener noreferrer">QQ 群</Link><span className="mx-2 text-nav/30" aria-hidden="true">/</span><Link className={footerLink} to={donationImage} reloadDocument target="_blank" rel="noopener noreferrer">捐赠以支持服务器运行</Link></p>
        <p><Link className={footerLink} to="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">赣ICP备2025074288号-1</Link></p>
      </div>
    </footer>
  </div>;
}

function GameShelf({products, multiplayer}: {products: readonly LibraryProduct[]; multiplayer: boolean}) {
  const [selectedId, setSelectedId] = useState<ProductId | undefined>(products[0]?.id);
  const rail = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<ProductId, HTMLAnchorElement>());
  const selected = products.some(product => product.id === selectedId) ? selectedId : products[0]?.id;
  const shelfId = multiplayer ? 'multiplayer' : 'singleplayer';
  const heading = multiplayer ? '联机' : '单机';

  function selectProduct(id: ProductId, focus = false) {
    setSelectedId(id);
    const card = cards.current.get(id);
    const owner = rail.current;
    if (!card || !owner) return;
    const left = owner.scrollLeft + card.getBoundingClientRect().left - owner.getBoundingClientRect().left - 6;
    owner.scrollTo({left: Math.max(0, left)});
    if (focus) card.focus({preventScroll: true});
  }

  function navigateCards(event: KeyboardEvent<HTMLAnchorElement>, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const destination = event.key === 'Home' ? 0 : event.key === 'End' ? products.length - 1
      : event.key === 'ArrowLeft' ? Math.max(0, index - 1)
      : event.key === 'ArrowRight' ? Math.min(products.length - 1, index + 1) : undefined;
    if (destination === undefined) return;
    event.preventDefault();
    selectProduct(products[destination].id, true);
  }

  if (!products.length) return null;

  return <section aria-labelledby={`${shelfId}-heading`} className="min-w-0">
    <div className="flex min-h-[38px] items-center gap-2.5 px-1.5 pb-1.5 library:min-h-11 library:gap-[18px] library:pb-2.5">
      <h2 id={`${shelfId}-heading`} className="text-xl leading-[1.3] font-bold tracking-[.04em] library:text-[22px]">{heading}</h2>
      {multiplayer && <span className="ml-auto inline-flex min-h-11 items-center gap-2 text-[11px] leading-[1.3] text-muted">
        <img src={roomUsersIcon} width={18} height={18} alt="" className="opacity-50"/>
        联机大厅待接入
      </span>}
    </div>
    <div ref={rail} id={`${shelfId}-rail`} role="group" aria-labelledby={`${shelfId}-heading`} className="scrollbar-none flex min-w-0 gap-3.5 overflow-x-auto overflow-y-hidden overscroll-x-contain scroll-px-1.5 p-1.5 pb-3.5 motion-safe:scroll-smooth max-library:-mr-[18px] max-library:pr-[18px] library:gap-5">
      {products.map((product, index) => {
        const active = selected === product.id;
        return <Link key={product.id} to={`/games/${product.id}`} ref={element => {
          if (element) cards.current.set(product.id, element);
          else cards.current.delete(product.id);
        }} onFocus={() => setSelectedId(product.id)} onKeyDown={event => navigateCards(event, index)}
          aria-label={`${product.title}${multiplayer ? ' 联机版' : ''} · 查看样本页面`}
          className={`group relative isolate flex h-[clamp(220px,31svh,290px)] w-[62vw] shrink-0 flex-col justify-between overflow-hidden rounded-[22px] border bg-panel p-[18px] text-paper no-underline shadow-card transition-colors motion-reduce:transition-none max-library:portrait:h-[clamp(210px,29svh,260px)] max-library:portrait:w-[clamp(186px,52vw,260px)] library:h-[clamp(220px,32vh,350px)] library:w-[clamp(230px,24vw,360px)] library:rounded-card library:p-[22px] ${active ? 'border-paper outline-2 outline-offset-2 outline-paper' : 'border-white/15 hover:border-paper/60'}`}>
          <span className={`main-cover-fallback pointer-events-none absolute inset-0 -z-10 transition-transform duration-300 motion-reduce:transition-none ${active ? 'scale-[1.018]' : ''}`} aria-hidden="true">
            {product.artwork && <img src={product.artwork} alt="" width={640} height={480} decoding="async" loading={index === 0 ? 'eager' : 'lazy'} className="size-full object-cover" style={{objectPosition: `${product.artworkPosition ?? 50}% center`}}/>}
            <span className={`main-cover-shade absolute inset-0 transition-opacity duration-200 motion-reduce:transition-none ${active ? 'opacity-30' : ''}`}/>
          </span>
          <span className={`main-card-text-shadow origin-top-left text-[42px] leading-none font-medium tracking-[-.055em] tabular-nums transition-transform duration-300 ease-main motion-reduce:transition-none library:text-[52px] ${active ? 'scale-[1.08] text-paper' : 'text-white/75'}`} aria-hidden="true">{product.number}</span>
          <span className="min-w-0 pt-6">
            <span className={`main-card-text-shadow block origin-bottom-left text-[27px] leading-[1.2] font-bold tracking-[.01em] whitespace-nowrap transition-transform duration-300 ease-main motion-reduce:transition-none max-library:portrait:text-[clamp(22px,6vw,27px)] library:text-[clamp(25px,2.2vw,34px)] ${active ? '-translate-y-[3px] scale-[1.025]' : 'translate-y-[3px]'}`}>{product.title}</span>
            <span className={`mt-2 block text-[11px] leading-[1.4] tracking-[.02em] transition-opacity motion-reduce:transition-none library:text-xs ${active ? 'opacity-100' : 'opacity-55'}`}>{product.subtitle}</span>
          </span>
        </Link>;
      })}
    </div>
    {products.length > 1 && <nav aria-label={`${heading}作品快速导航`} className="mx-auto flex min-h-11 w-max max-w-full flex-wrap justify-center gap-0.5 sm:gap-2">
      {products.map(product => <button key={product.id} type="button" aria-label={`浏览${product.title}`} aria-controls={`${shelfId}-rail`} aria-pressed={selected === product.id} onClick={() => selectProduct(product.id)} className={`grid size-11 place-items-center rounded-lg text-base leading-none font-semibold tracking-[.04em] transition-colors motion-reduce:transition-none ${selected === product.id ? 'bg-nav-hover text-nav-ink' : 'text-muted hover:bg-white/5 hover:text-paper'}`}>{product.number}</button>)}
    </nav>}
  </section>;
}

export function GameLibrary({products = currentLibraryProducts}: {products?: readonly LibraryProduct[]}) {
  const visible = products.filter(product => productEnabledForBuild(product.id, false));
  return <div className="grid min-w-0 gap-[22px] library:gap-7">
    <h1 className="sr-only">东方Project 原作 STG ~ EAGLER TOUHOU</h1>
    <GameShelf products={visible.filter(product => !isMultiplayerProductId(product.id))} multiplayer={false}/>
    <GameShelf products={visible.filter(product => isMultiplayerProductId(product.id))} multiplayer/>
    <p className="px-1.5 text-[11px] leading-relaxed text-muted">main 界面样本。游戏卡片进入样本页面，启动与联机功能尚未接入。当前检出缺少的封面沿用 main 的缺图样式。</p>
  </div>;
}
