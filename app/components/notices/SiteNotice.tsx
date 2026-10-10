import {Fragment, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties, type Ref} from 'react';
import {createEdgeDrawerGesture} from '../../../src/launcher/edge-drawer-gesture.mts';
import {useLocale} from '../../i18n';
import type {SitePreferencesModel} from '../../models/site-preferences';
import {createSiteNoticeState, type SiteNoticeEnvironment} from './site-notice-state';

export interface SiteNoticeHandle {
  load(): Promise<boolean>;
  close(): void;
  isOpen(): boolean;
  isEnabled(): boolean;
}
export interface SiteNoticeProps {
  preferences: SitePreferencesModel;
  assetUrl?: (path: string) => string;
  /** Startup sequencing stays with the host: first-use notice, room and embed gates. */
  autoLoad?: boolean;
  /** Original launcher has left-edge gestures; original lobby does not. */
  edgeGestures?: boolean;
  onOptOut?: (restoreHint: string) => void;
  environment?: SiteNoticeEnvironment;
  ref?: Ref<SiteNoticeHandle>;
}
const identityAsset = (path: string) => path;

/** Original public/index.html #siteNotice DOM and catalog copy. No new surface,
 * history entry, content HTML, styles, or extra layout wrapper is introduced.
 */
export function SiteNotice({preferences, assetUrl = identityAsset, autoLoad = false, edgeGestures = true,
  onOptOut, environment, ref}: SiteNoticeProps) {
  const {t} = useLocale();
  const bar = useRef<HTMLDivElement>(null);
  const state = useMemo(() => createSiteNoticeState(preferences, environment), [preferences, environment]);
  const snapshot = useSyncExternalStore(state.subscribe, state.getSnapshot, state.getSnapshot);
  const nativeOpen = () => !!bar.current && !bar.current.hidden && !bar.current.classList.contains('site-notice-closing');
  useImperativeHandle(ref, () => ({load: state.load, close: state.close, isOpen: nativeOpen, isEnabled: state.isEnabled}), [state]);
  useLayoutEffect(() => state.connect(), [state]);
  // Main's external DOM contract permits hiding the original banner directly
  // (including the unchanged edge-drawer browser-test setup). A subsequent
  // explicit successful reveal must restore the actual hidden attribute even
  // if React's preceding snapshot also had hidden=false.
  useLayoutEffect(() => {if (bar.current) bar.current.hidden = snapshot.hidden;}, [snapshot]);
  useEffect(() => {
    const node = bar.current;
    if (!node) return;
    const documentObj = node.ownerDocument;
    const windowObj = documentObj.defaultView;
    if (!windowObj) return;
    const scrollingElement = () => documentObj.scrollingElement || documentObj.documentElement;
    const rememberScroll = () => {
      const target = scrollingElement();
      state.rememberScroll(target, windowObj.scrollY || target.scrollTop || 0);
    };
    let previous = state.getSnapshot();
    const unsubscribe = state.subscribe(() => {
      const next = state.getSnapshot();
      // A successful load replaces the parsed lines, including when already open.
      if (next.lines !== previous.lines) rememberScroll();
      previous = next;
    });
    const handleScroll = (event: Event) => {
      const root = scrollingElement();
      const eventTarget = event.target as {scrollTop?: unknown} | null;
      const target = eventTarget && typeof eventTarget.scrollTop === 'number' ? eventTarget : root;
      const current = target === root ? (windowObj.scrollY || root.scrollTop || 0) : Number(target.scrollTop) || 0;
      state.scroll(target, current);
    };
    rememberScroll();
    documentObj.addEventListener('scroll', handleScroll, {capture: true, passive: true});
    const gestures = edgeGestures ? createEdgeDrawerGesture({documentObj, windowObj, side: 'left', drawer: node,
      isOpen: nativeOpen, open: state.load, close: state.close, enabled: state.isEnabled}) : null;
    return () => {
      unsubscribe(); gestures?.destroy();
      documentObj.removeEventListener('scroll', handleScroll, {capture: true});
    };
  }, [state, edgeGestures]);
  useEffect(() => {if (autoLoad) void state.load();}, [state, autoLoad]);
  const className = ['site-notice', snapshot.scrollHidden && 'site-notice-scroll-hidden', snapshot.closing && 'site-notice-closing'].filter(Boolean).join(' ');
  const style = snapshot.durationMs === null ? undefined : {'--site-notice-duration': `${snapshot.durationMs}ms`} as CSSProperties;
  return <div ref={bar} className={className} id="siteNotice" role="region" aria-label={t('notice.aria')}
    data-i18n-aria-label="notice.aria" aria-live="polite" hidden={snapshot.hidden} style={style}>
    <div className="site-notice-header">
      <strong className="site-notice-label" data-i18n="notice.label">{t('notice.label')}</strong>
      <div className="site-notice-actions">
        <button className="site-notice-opt-out" id="siteNoticeOptOut" type="button" data-i18n="notice.dismissForever"
          hidden={!snapshot.optOutVisible} onClick={() => {state.optOut(); onOptOut?.(t('notice.restoreHint'));}}>{t('notice.dismissForever')}</button>
        <button className="site-notice-close" id="siteNoticeClose" type="button" aria-label={t('notice.close')}
          data-i18n-aria-label="notice.close" onClick={state.dismiss}>×</button>
      </div>
    </div>
    <div className="site-notice-content" id="siteNoticeContent">
      {snapshot.lines.map((line, lineIndex) => <div className="site-notice-line" key={lineIndex}>
        {line.map((segment, segmentIndex) => segment.type === 'text' ? <Fragment key={segmentIndex}>{segment.text}</Fragment>
          : <a key={segmentIndex} className="site-notice-brand" href={segment.href} title={segment.resolvedHref}
            target={segment.external ? '_blank' : undefined} rel={segment.external ? 'noopener noreferrer' : undefined}>
            {segment.asset && <span className="site-notice-brand-icon"><img src={assetUrl(segment.asset)} alt="" decoding="async"/></span>}
            <span>{segment.label}</span>
          </a>)}
      </div>)}
    </div>
    <span className="site-notice-life" aria-hidden="true"><i/></span>
  </div>;
}
