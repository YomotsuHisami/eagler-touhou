import {useLayoutEffect, useRef, useState} from 'react';
import {normalizeRoomCode} from '../../../src/launcher/route-state.mts';
import {useLocale} from '../../i18n';

export interface MultiplayerOnlineFoldProps {
  configuration: 'loading' | 'missing' | 'ready';
  onCreate(): void;
  onJoin(code: string): void;
  onInvalidCode(): void;
}
/** Main index368–376 + app4655–4667/6569–6574/6632–6641/7522–7549.
 * Mature main keeps this legacy entry hidden (styles22 !important); restore
 * its real DOM/action contract without reopening the retired visible flow. */
export function MultiplayerOnlineFold({configuration, onCreate, onJoin, onInvalidCode}: MultiplayerOnlineFoldProps) {
  const {t} = useLocale(), ready = configuration === 'ready';
  const [open, setOpen] = useState(ready), [code, setCode] = useState('');
  const wasReady = useRef(false), body = useRef<HTMLDivElement>(null);
  const updateCode = (event: {currentTarget: HTMLInputElement}) => {const normalized = normalizeRoomCode(event.currentTarget.value); event.currentTarget.value = normalized; setCode(normalized);};
  useLayoutEffect(() => {
    if (!ready) setOpen(false);
    else if (!wasReady.current) setOpen(true);
    wasReady.current = ready;
  }, [ready]);
  useLayoutEffect(() => {
    const node = body.current;
    if (!node) return;
    if (!open) {node.style.removeProperty('--mp-fold-height'); return;}
    const frame = requestAnimationFrame(() => {
      let height = node.scrollHeight;
      const nested = node.querySelector<HTMLElement>('.mobile-options.open .mobile-options-body');
      if (nested) height += Math.max(0, nested.scrollHeight - nested.clientHeight);
      node.style.setProperty('--mp-fold-height', `${height + 12}px`);
    });
    return () => cancelAnimationFrame(frame);
  }, [open, t]);
  return <section className={`mp-fold mp-fold-online${open ? ' open' : ''}`} id="mpOnlineFold" hidden>
    <button className="mp-fold-head" type="button" data-mp-fold="online" aria-expanded={open} disabled={!ready} title={ready ? '' : t(configuration === 'loading' ? 'multiplayer.configLoading' : 'multiplayer.serviceMissing')} onClick={() => setOpen(value => !value)}><span>{t('multiplayer.title')}</span><i aria-hidden="true">⌄</i></button>
    <div ref={body} className="mp-fold-body" data-mp-fold-body="online" aria-hidden={!open} inert={!open}>
      <button className="mp-primary-action" id="mpCreateRoom" type="button" disabled={!ready} onClick={onCreate}>{t('multiplayer.createRoom')}</button>
      <div className="mp-join-separator"><span>{t('multiplayer.or')}</span></div>
      <label className="mp-room-code-input"><span>{t('multiplayer.roomCode')}</span><input id="mpJoinCode" inputMode="numeric" autoComplete="off" maxLength={8} placeholder={t('multiplayer.roomCodePlaceholder')} disabled={!ready} value={code} onInput={updateCode} onChange={updateCode}/></label>
      <button className="mp-secondary-action" id="mpJoinRoom" type="button" disabled={!ready} onClick={() => {const normalized = normalizeRoomCode(code); if (normalized) onJoin(normalized); else onInvalidCode();}}>{t('multiplayer.joinRoom')}</button>
    </div>
  </section>;
}
