import {useEffect, useLayoutEffect, useRef} from 'react';
import {renderContentFragment} from '../../../src/launcher/content-fragment.mts';
import {useLocale} from '../../i18n';
import {buildRuleGuide, DEFAULT_GUIDE_GAME} from '../../../src/launcher/multiplayer-guide-content.mts';
import {useMainDialog, type MainDialogProps} from './use-main-dialog';
export interface MultiplayerGuideDialogProps extends MainDialogProps {
  gameId: string;
  contentUrl?: string;
  fetchImpl?: typeof fetch;
}
/** Main opens immediately, loads/sanitizes once, retries errors, selects current game. */
export function MultiplayerGuideDialog({gameId, contentUrl = 'content/MULTIPLAYER.html', fetchImpl = fetch, ...props}: MultiplayerGuideDialogProps) {
  const {t} = useLocale(), dialog = useMainDialog(props, 180);
  const content = useRef<HTMLDivElement>(null), loaded = useRef(false), pending = useRef<Promise<void> | null>(null);
  const active = useRef(false), generation = useRef(0);
  const latest = useRef({t, gameId, contentUrl, fetchImpl}); latest.current = {t, gameId, contentUrl, fetchImpl};
  function status(text: string, className: string) {
    const target = content.current; if (!target || !active.current) return;
    const paragraph = target.ownerDocument.createElement('p'); paragraph.className = className; paragraph.textContent = text; target.replaceChildren(paragraph);
  }
  useLayoutEffect(() => {
    active.current = true;
    if (!content.current?.childNodes.length) status(latest.current.t('multiplayerGuide.loading'), 'multiplayer-guide-loading');
    return () => {active.current = false; generation.current++; pending.current = null;};
  }, []);
  useLayoutEffect(() => {
    if (content.current?.firstElementChild?.className === 'multiplayer-guide-loading') status(t('multiplayerGuide.loading'), 'multiplayer-guide-loading');
  }, [t]);
  useEffect(() => {
    if (!props.open) return;
    const token = generation.current;
    const select = () => {
      if (active.current && token === generation.current) content.current?.querySelector('[data-mp-rule-guide]')?.dispatchEvent(new CustomEvent('mp-guide-select-game', {detail: latest.current.gameId}));
    };
    if (loaded.current) {select(); return;}
    if (!pending.current) {
      const request = (async () => {
        try {
          const response = await latest.current.fetchImpl(latest.current.contentUrl);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const html = await response.text();
          if (!active.current || token !== generation.current || !content.current) return;
          renderContentFragment(content.current, html, content.current.ownerDocument);
          buildRuleGuide(content.current, content.current.ownerDocument, latest.current.gameId || DEFAULT_GUIDE_GAME);
          loaded.current = true;
        } catch (error) {
          if (active.current && token === generation.current) status(latest.current.t('multiplayerGuide.readFailed', {reason: error instanceof Error ? error.message : String(error)}), 'multiplayer-guide-error');
        }
      })();
      pending.current = request;
      void request.finally(() => {if (pending.current === request) pending.current = null;});
    }
    void pending.current.then(select);
  }, [props.open, gameId]);
  return <dialog ref={dialog.ref} className="multiplayer-guide-dialog" id="mpGuideDialog" aria-labelledby="mpGuideTitle" onCancel={dialog.onCancel} onClick={dialog.onClick}>
    <article className="multiplayer-guide-window"><header><h1 id="mpGuideTitle">{t('multiplayerGuide.title')}</h1><button id="mpGuideClose" type="button" aria-label={t('multiplayerGuide.close')} onClick={dialog.requestClose}>×</button></header><div ref={content} className="multiplayer-guide-content" id="mpGuideContent"/></article>
  </dialog>;
}
