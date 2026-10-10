import {useEffect, useLayoutEffect, useRef, type ReactNode} from 'react';
import {useLocale} from '../../i18n';
import {mastheadIcons} from './masthead-icons';
import {AppLink} from './AppLink';
import {closeMainSelectMenus, MainSelectPrefix} from './MainSelect';

export interface LauncherMastheadProps {
  /** Published pre-session markup has native links and no menu owner. */
  interactive?: boolean;
  variant: 'library' | 'lobby';
  assetUrl: (path: string) => string;
  launcherHref: string;
  faqHref: string;
  aboutHref: string;
  migrationHref?: string;
  migrationPolicyKnown?: boolean;
  updatedAge?: {text: string; title?: string; dateTime?: string};
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  lessMotion: boolean;
  onToggleMotion: () => void;
  noticeEnabled: boolean;
  onToggleNotice: () => void;
  diagnosticsEnabled: boolean;
  onToggleDiagnostics: () => void;
  onDonation: () => void;
  donationAvailable?: boolean;
  onFirstUse: () => void;
  /** The shared MainSelect, with the original uiLanguageSelect native props. */
  languageControl: ReactNode;
}

/** Original index.html320–345 / lobby.html45–70 shared masthead.
 * Menu keyboard/outside-click behavior: main app.mts8749–8774.
 */
export function LauncherMasthead(props: LauncherMastheadProps) {
  const {t} = useLocale();
  const {variant, assetUrl, menuOpen, onMenuOpenChange, interactive = true} = props;
  const Link = interactive ? AppLink : 'a';
  const menu = useRef<HTMLDivElement>(null), toggle = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const focusFirst = useRef(false), callbacks = useRef(onMenuOpenChange); callbacks.current = onMenuOpenChange;
  useEffect(() => {
    if (!interactive) return;
    const outside = (event: MouseEvent) => {
      if (variant === 'lobby' && event.target instanceof Element && event.target.closest('.mizuki-select-menu')) return;
      if (event.target instanceof Node && !menu.current?.contains(event.target)) callbacks.current(false);
    };
    document.addEventListener('click', outside);
    return () => document.removeEventListener('click', outside);
  }, [variant, interactive]);
  useLayoutEffect(() => {
    if (!interactive) return;
    if (!menuOpen && variant === 'lobby') closeMainSelectMenus();
    if (menuOpen && focusFirst.current) {
      focusFirst.current = false;
      panel.current?.querySelector<HTMLElement>('.mizuki-select-trigger, .masthead-menu-item')?.focus();
    }
  }, [menuOpen, variant, interactive]);
  return <header className={`masthead${variant === 'lobby' ? ' lobby-masthead' : ''}`}>
    {variant === 'lobby' ? <Link className="masthead-link lobby-back" id="launcherLink" href={props.launcherHref}><img src={assetUrl('assets/room-caret-left.svg')} alt="" width="20" height="20"/><span>{t('lobby.back')}</span></Link>
      : <div className="brand" aria-label="EAGLER TOUHOU"><span className="brand-eagler"><span className="brand-title">EAGLER</span><time className="brand-version" id="brandUpdateAge" title={props.updatedAge?.title} dateTime={props.updatedAge?.dateTime}>{props.updatedAge?.text ?? t('brand.neverUpdated')}</time></span><span className="brand-separator" aria-hidden="true"><span className="brand-yinyang">☯</span></span><span className="brand-title">TOUHOU</span></div>}
    <nav className="masthead-links" aria-label={t('nav.siteInfo')}>
      <a className="masthead-link" id="originMigrationOpen" href={props.migrationHref ?? 'migrate.html'} hidden={!props.migrationHref} data-policy={props.migrationPolicyKnown ? 'host-manifest-origin-migration-policy/1' : undefined}><span className="masthead-label"><span>{t('nav.oldSitePart1')}</span><wbr/><span>{t('nav.migrationPart2')}</span></span></a>
      <button className="masthead-link" id="donationOpenTop" type="button" hidden={props.donationAvailable === false} onClick={props.onDonation}><span className="masthead-label">{t('nav.donate')}</span></button>
      <a className="masthead-link" href={props.faqHref}><span className="masthead-label"><span>{t('nav.faqFirst')}</span><wbr/><span>{t('nav.faqSecond')}</span></span></a>
      <a className="masthead-link masthead-github" href="https://github.com/YomotsuHisami/eagler-touhou" target="_blank" rel="noopener noreferrer" aria-label="GitHub" dangerouslySetInnerHTML={{__html: mastheadIcons.github}}/>
      <div ref={menu} className="masthead-menu" id="mastheadMenu" onKeyDown={event => {
        if (event.key !== 'Escape') return;
        if (variant === 'lobby') event.stopPropagation();
        event.preventDefault(); onMenuOpenChange(false); toggle.current?.focus();
      }}>
        <button ref={toggle} className="masthead-link masthead-menu-toggle" id="mastheadMenuToggle" type="button" aria-label={t('nav.more')} aria-expanded={menuOpen} aria-controls="mastheadMenuPanel" onClick={() => onMenuOpenChange(!menuOpen)} onKeyDown={event => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          if (menuOpen) panel.current?.querySelector<HTMLElement>('.mizuki-select-trigger, .masthead-menu-item')?.focus();
          else {focusFirst.current = true; onMenuOpenChange(true);}
        }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5-5 5 5M7 15l5 5 5-5"/></svg></button>
        <div ref={panel} className="masthead-menu-panel" id="mastheadMenuPanel" aria-hidden={!menuOpen} inert={!menuOpen}>
          <button className="masthead-menu-item motion-menu-toggle" id={variant === 'lobby' ? 'lobbyLessMotion' : 'lessMotionToggle'} type="button" aria-pressed={props.lessMotion} title={t(props.lessMotion ? 'nav.motionFullTitle' : 'nav.motionLessTitle')} onClick={props.onToggleMotion}><MenuIcon name="motion"/><span>{t('nav.lessMotion')}</span><i className="site-notice-toggle-state" aria-hidden="true"/></button>
          <button className="masthead-menu-item" id="siteNoticeToggle" type="button" role="switch" aria-checked={props.noticeEnabled} onClick={props.onToggleNotice}><MenuIcon name="notice"/><span>{t('notice.label')}</span><i className="site-notice-toggle-state" aria-hidden="true"/></button>
          <button className="masthead-menu-item" id="runtimeDiagnosticsToggle" type="button" role="switch" aria-checked={props.diagnosticsEnabled} onClick={props.onToggleDiagnostics}><MenuIcon name="diagnostics"/><span>{t('diagnostics.toggle')}</span><i className="site-notice-toggle-state" aria-hidden="true"/></button>
          <div className="ui-language-control masthead-menu-language"><MainSelectPrefix prefix={<MenuIcon name="language"/>}>{props.languageControl}</MainSelectPrefix><template data-select-trigger-prefix="" dangerouslySetInnerHTML={{__html: mastheadIcons.language}}/></div>
          <button className="masthead-menu-item" id="firstUseNoticeOpen" type="button" onClick={() => {onMenuOpenChange(false); props.onFirstUse();}}><MenuIcon name="firstUse"/><span>{t('nav.firstUseNotice')}</span></button>
          <a className="masthead-menu-item" href={props.aboutHref}><MenuIcon name="about"/><span>{t('nav.about')}</span></a>
        </div>
      </div>
    </nav>
  </header>;
}

function MenuIcon({name}: {name: 'motion' | 'notice' | 'diagnostics' | 'firstUse' | 'about' | 'language'}) {
  // Preserve the original SVG as the direct child, with no layout wrapper.
  const svg = mastheadIcons[name];
  const path = svg.match(/<path d="([^"]*)"/)![1];
  return <svg className="masthead-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={path}/></svg>;
}
