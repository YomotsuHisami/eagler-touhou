import type {ReactNode} from 'react';

export interface TransientWindowProps {
  id: string;
  titleId: string;
  title: ReactNode;
  closeId: string;
  closeLabel: string;
  open: boolean;
  busy?: boolean;
  /** A reference panel sits above the standard task panel and permits copying. */
  variant?: 'standard' | 'reference';
  onClose(): void;
  children: ReactNode;
}

// These compatibility classes already share the same authored shell/header CSS.
// Retaining them also keeps main's static markup and production CSS unchanged.
const presentationClass = {
  standard: 'game-data-import-window',
  reference: 'game-data-link-window',
} as const;

/** Controlled, nonmodal presentation. Children remain mounted when hidden.
 * The caller owns presentation events, focus, fullscreen placement and work;
 * this shell adds no native dialog, Escape/outside dismissal or history layer.
 */
export function TransientWindow({id, titleId, title, closeId, closeLabel, open, busy,
  variant = 'standard', onClose, children}: TransientWindowProps) {
  return <section className={presentationClass[variant]} id={id} role="dialog" aria-modal="false" aria-labelledby={titleId} aria-busy={busy} hidden={!open}>
    <header><div><strong id={titleId}>{title}</strong></div><button id={closeId} type="button" aria-label={closeLabel} disabled={busy} onClick={onClose}>×</button></header>
    {children}
  </section>;
}
