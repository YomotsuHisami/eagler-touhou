import { useCallback, useLayoutEffect, useRef, useId, type ReactNode, type RefObject } from 'react';
import * as Primitive from '@radix-ui/react-dialog';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { Button } from './Button';
import { useUiReducedMotion, useUiText } from '../services/ui-preferences';
import styles from './dialog.module.css';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
  className?: string;
  placement?: 'responsive' | 'right';
  backdrop?: 'dim' | 'transparent';
  onExitComplete?: () => void;
  /** Stable trigger when a menu item unmounts while opening this dialog. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Closing releases Radix focus, scroll, and dismissal ownership immediately.
 * Motion retains only an inert DOM snapshot, never a live business component.
 * Keep this component mounted and change `open` to animate a local close.
 * Route owners navigate immediately; they must not navigate in onExitComplete.
 */
export function Dialog(props: DialogProps) {
  return <DialogSurface {...props} kind="dialog" />;
}

export function Sheet(props: DialogProps) {
  return <DialogSurface {...props} kind="sheet" />;
}

type SurfaceProps = DialogProps & { kind: 'dialog' | 'sheet' };

function DialogSurface(props: SurfaceProps) {
  const openRef = useRef(props.open);
  const onExitRef = useRef(props.onExitComplete);
  openRef.current = props.open;
  onExitRef.current = props.onExitComplete;
  return <AnimatePresence onExitComplete={() => {
    // A superseding open owns the surface; an old exit has no authority.
    if (!openRef.current) onExitRef.current?.();
  }}>{props.open && <DialogSession key="surface" {...props} />}</AnimatePresence>;
}

function DialogSession({ onOpenChange, title, description, children, footer, closeLabel, className = '', kind, returnFocusRef, placement = 'responsive', backdrop = 'dim' }: SurfaceProps) {
  const isPresent = useIsPresent();
  const descriptionId = useId();
  const reduceMotion = useUiReducedMotion();
  const t = useUiText();
  const presentRef = useRef(isPresent);
  presentRef.current = isPresent;
  const openerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const detachedRef = useRef<HTMLDivElement | null>(null);
  const snapshotRef = useRef<Node | null>(null);
  const snapshotHostRef = useRef<HTMLDivElement | null>(null);
  const restoredRef = useRef(false);
  const captureContent = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      contentRef.current = node;
    } else if (contentRef.current) {
      // Clone the actual rendered state after React disconnects the live panel.
      // cloneNode copies no React handlers, effects, or subscriptions.
      detachedRef.current = contentRef.current;
      snapshotRef.current = contentRef.current.cloneNode(true);
      contentRef.current = null;
    }
  }, []);
  useLayoutEffect(() => {
    if (isPresent) {
      restoredRef.current = false;
      snapshotRef.current = null;
    } else if (snapshotHostRef.current && snapshotRef.current) {
      const snapshot = snapshotRef.current;
      if (snapshot instanceof HTMLElement) {
        snapshot.inert = true;
        snapshot.removeAttribute('data-ui-dialog-live');
        snapshot.removeAttribute('role');
        snapshot.setAttribute('aria-hidden', 'true');
        // Prevent duplicate document identities during a rapid different open.
        snapshot.removeAttribute('id');
        snapshot.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
      }
      snapshotHostRef.current.replaceChildren(snapshot);
    }
  }, [isPresent]);
  const requestClose = useCallback(() => {
    if (presentRef.current) onOpenChange(false);
  }, [onOpenChange]);
  useLayoutEffect(() => {
    if (!isPresent) return;
    // Radix registers dismissal in a passive effect after its layer rerenders.
    // Own Escape from the content commit, including the first animation frame.
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !presentRef.current || !contentRef.current) return;
      const liveDialogs = document.querySelectorAll('[data-ui-dialog-live]');
      if (liveDialogs[liveDialogs.length - 1] !== contentRef.current) return;
      event.preventDefault();
      requestClose();
    };
    document.addEventListener('keydown', onEscape, true);
    return () => document.removeEventListener('keydown', onEscape, true);
  }, [isPresent, requestClose]);
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    if (presentRef.current || restoredRef.current) return;
    restoredRef.current = true;
    // A newer dialog or a deliberately focused route wins over an old opener.
    if (document.querySelector('[data-ui-dialog-live]')) return;
    const active = document.activeElement;
    const focusWasOurs = active === document.body || active === null || detachedRef.current?.contains(active);
    if (focusWasOurs && openerRef.current?.isConnected && !openerRef.current.closest('[inert]')) {
      openerRef.current.focus({ preventScroll: true });
    }
  };
  const duration = reduceMotion ? 0 : .2;
  const panelClosed = reduceMotion ? { opacity: 0 } : kind === 'sheet' ? { opacity: 0, x: 28 } : { opacity: 0, y: 16, scale: .975 };
  return <Primitive.Root open={isPresent} onOpenChange={next => { if (!next) requestClose(); }}>
    <Primitive.Portal forceMount>
      <motion.div className={`${styles.overlay} ${backdrop === 'transparent' ? styles.transparent : ''} ${!isPresent ? styles.exiting : ''}`} aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration }}>
        {isPresent && <Primitive.Overlay className={styles.scrollLock} />}
      </motion.div>
      <div className={`${styles.positioner} ${kind === 'sheet' ? styles.sheetPositioner : ''} ${placement === 'right' ? styles.rightPositioner : ''}`} inert={!isPresent ? true : undefined} aria-hidden={!isPresent ? true : undefined}>
        <motion.section className={`${styles.panel} ${kind === 'sheet' ? styles.sheet : ''} ${placement === 'right' ? styles.rightPanel : ''} ${!isPresent ? styles.exiting : ''} ${className}`} initial={panelClosed} animate={{ opacity: 1, x: 0, y: 0, scale: 1 }} exit={panelClosed} transition={{ duration, ease: [.22, .8, .22, 1] }}>
          {isPresent ? <Primitive.Content asChild aria-describedby={description ? descriptionId : undefined} onOpenAutoFocus={() => {
            const active = returnFocusRef?.current ?? document.activeElement;
            if (active instanceof HTMLElement && !contentRef.current?.contains(active)) openerRef.current = active;
          }} onCloseAutoFocus={restoreFocus}>
            <div ref={captureContent} className={styles.panelInner} data-ui-dialog-live="true">
              <header className={styles.header}><div className={styles.heading}>
                <Primitive.Title className={styles.title}>{title}</Primitive.Title>
                {description && <Primitive.Description id={descriptionId} className={styles.description}>{description}</Primitive.Description>}
              </div><Button variant="ghost" size="icon" className={styles.close} aria-label={closeLabel ?? t('action.close')} onClick={requestClose}><span aria-hidden="true">×</span></Button></header>
              <div className={styles.body}>{children}</div>
              {footer && <footer className={styles.footer}>{footer}</footer>}
            </div>
          </Primitive.Content> : <div ref={snapshotHostRef} className={styles.snapshot} inert aria-hidden="true" />}
        </motion.section>
      </div>
    </Primitive.Portal>
  </Primitive.Root>;
}
