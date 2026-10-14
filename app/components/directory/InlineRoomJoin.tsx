import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {useLocale} from '../../i18n';

/** Local disclosure only; the directory service owns lookup and room entry. */
export function InlineRoomJoin({disabled, busy, error, label, onJoin, onCancel}: {
  disabled: boolean; busy: boolean; error: string; label: string;
  onJoin(code: string): void; onCancel(): void;
}) {
  const {t} = useLocale();
  const [expanded, setExpanded] = useState(false), [code, setCode] = useState('');
  const input = useRef<HTMLInputElement>(null), container = useRef<HTMLDivElement>(null), open = useRef(false);
  const close = useCallback(() => {
    if (!open.current) return;
    open.current = false; onCancel(); setExpanded(false);
  }, [onCancel]);
  useLayoutEffect(() => {
    if (expanded) input.current?.focus({preventScroll:true});
  }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: Event) => {if (event.target instanceof Node && !container.current?.contains(event.target)) close();};
    document.addEventListener('pointerdown',outside,true);
    document.addEventListener('focusin',outside,true);
    return () => {document.removeEventListener('pointerdown',outside,true); document.removeEventListener('focusin',outside,true);};
  }, [expanded,close]);
  useLayoutEffect(() => () => onCancel(), [onCancel]);
  return <div ref={container} className="lobby-code-join" data-expanded={expanded} onBlur={event => {
    const next = event.relatedTarget;
    // Submitting temporarily disables the focused input/button. That native
    // blur is not an outside interaction and must not cancel the lookup.
    if ((!next || !event.currentTarget.contains(next as Node)) && (next || !busy)) close();
  }}>
    <button className="lobby-button lobby-secondary lobby-code-trigger" id="codeButton" type="button"
      disabled={disabled} aria-expanded={expanded} aria-controls="lobbyCodeForm" aria-hidden={expanded || undefined}
      tabIndex={expanded ? -1 : 0} onClick={() => {open.current = true; setExpanded(true);}}>{label}</button>
    <form className="lobby-code-form" id="lobbyCodeForm" aria-hidden={!expanded} aria-busy={busy} noValidate onSubmit={event => {
      event.preventDefault(); if (!disabled && expanded) onJoin(code);
    }}>
      <input ref={input} id="lobbyCodeInput" type="text" inputMode="numeric" autoComplete="off" maxLength={8}
        placeholder={t('workspace.roomCodePlaceholder')} aria-label={t('workspace.roomCodePlaceholder')}
        aria-invalid={!!error} aria-describedby={error ? 'lobbyCodeError' : undefined} disabled={!expanded || disabled}
        tabIndex={expanded ? 0 : -1} value={code} onChange={event => {setCode(event.target.value); onCancel();}}/>
      <button className="lobby-button lobby-code-submit" id="lobbyCodeSubmit" type="submit" disabled={!expanded || disabled}
        tabIndex={expanded ? 0 : -1} aria-label={t('lobby.joinRoom')} title={t('lobby.joinRoom')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>
      </button>
    </form>
    <p id="lobbyCodeError" className="lobby-code-error" role="alert" hidden={!expanded || !error}>{error}</p>
  </div>;
}
