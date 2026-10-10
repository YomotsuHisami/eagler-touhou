import {useEffect, useRef} from 'react';
import {useLocale} from '../i18n';
import {closeMainSelectMenus} from './launcher/MainSelect';

/** Main's decision-dialog structure, focus and discard/cancel behavior. No history owner. */
export function ConfirmationDialog({open, title, message, confirmText, cancelText, tone = 'normal', secondaryText = '', variant = '', hideCancel = false, confirmOnEnter = false, onConfirm, onCancel, onSecondary}: {
  open: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  tone?: 'normal' | 'danger';
  secondaryText?: string;
  variant?: string;
  hideCancel?: boolean;
  confirmOnEnter?: boolean;
  onConfirm(): void;
  onCancel(): void;
  onSecondary?(): void;
}) {
  const {t} = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishRef = useRef<(() => void) | null>(null);
  const callbacks = useRef({onConfirm, onCancel, onSecondary});
  callbacks.current = {onConfirm, onCancel, onSecondary};
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    closeMainSelectMenus();
    const focusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let settled = false;
    const closed = () => {
      // Main app.mts8972 settles native close(), not only our button path.
      // A queued close from an effect replay cannot settle a reopened dialog.
      if (dialog.open || settled) return;
      settled = true;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null; finishRef.current = null;
      dialog.classList.remove('closing');
      const choice = dialog.returnValue;
      if (choice === 'confirm') callbacks.current.onConfirm();
      else if (choice === 'secondary') callbacks.current.onSecondary?.();
      else callbacks.current.onCancel();
      if (focusReturn?.isConnected) focusReturn.focus({preventScroll: true});
    };
    dialog.addEventListener('close', closed);
    dialog.returnValue = 'cancel';
    dialog.showModal();
    (hideCancel ? confirmRef.current : cancelRef.current)?.focus({preventScroll: true});
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      finishRef.current = null;
      dialog.classList.remove('closing');
      dialog.removeEventListener('close', closed);
      if (dialog.open) dialog.close();
      if (!settled && focusReturn?.isConnected) focusReturn.focus({preventScroll: true});
    };
  }, [open, hideCancel]);
  function close(choice: 'confirm' | 'cancel' | 'secondary') {
    const dialog = dialogRef.current;
    if (!dialog?.open || finishRef.current) return;
    dialog.returnValue = choice;
    const finish = () => {
      if (finishRef.current !== finish) return;
      finishRef.current = null;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      dialog.classList.remove('closing');
      if (dialog.open) dialog.close(choice);
    };
    finishRef.current = finish;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else {
      dialog.classList.add('closing');
      timer.current = setTimeout(finish, 220);
    }
  }
  return <dialog ref={dialogRef} className="decision-dialog" id="decisionDialog"
    aria-labelledby="decisionTitle" aria-describedby="decisionMessage" data-tone={tone} data-options={secondaryText && !hideCancel ? "3" : "2"} data-variant={variant}
    data-confirm-on-enter={String(confirmOnEnter)} onCancel={event => {event.preventDefault(); close('cancel');}}
    onAnimationEnd={event => {if (event.animationName === 'decision-card-out') finishRef.current?.();}}
    onKeyDown={event => {
      if (event.key !== 'Enter' || event.target === cancelRef.current) return;
      event.preventDefault();
      if (confirmOnEnter) confirmRef.current?.click();
    }}>
    <form method="dialog" className="decision-window" onSubmit={event => {
      event.preventDefault();
      const submitter = (event.nativeEvent as SubmitEvent).submitter;
      const value = submitter instanceof HTMLButtonElement ? submitter.value : 'cancel';
      close(value === 'confirm' || value === 'secondary' ? value : 'cancel');
    }}>
      <div className="decision-body">
        <div className="decision-mark" aria-hidden="true">
          <svg className="decision-mark-normal" viewBox="0 0 24 24" focusable="false"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm0-14a4 4 0 0 0-4 4h2a2 2 0 1 1 4 0c0 .9-.52 1.33-1.28 1.96C11.8 12.72 11 13.57 11 15h2c0-.52.29-.84 1-1.43 1-.82 2-1.65 2-3.57a4 4 0 0 0-4-4Zm-1 11h2v2h-2v-2Z"/></svg>
          <svg className="decision-mark-danger" viewBox="0 0 24 24" focusable="false"><path d="M1 21h22L12 2 1 21Zm12-3h-2v2h2v-2Zm0-2h-2v-4h2v4Z"/></svg>
        </div>
        <header><strong id="decisionTitle">{title}</strong></header>
        <p id="decisionMessage">{message}</p>
      </div>
      <footer>
        <button ref={cancelRef} className="decision-cancel" id="decisionCancel" value="cancel" hidden={hideCancel}>{cancelText}</button>
        <button className="decision-secondary" id="decisionSecondary" value="secondary" hidden={!secondaryText}>{secondaryText || t('action.backgroundDownload')}</button>
        <button ref={confirmRef} className="decision-confirm" id="decisionConfirm" value="confirm">{confirmText}</button>
      </footer>
    </form>
  </dialog>;
}
