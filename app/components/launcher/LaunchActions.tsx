import type {ReactNode} from 'react';

export interface LaunchAction {
  id: string;
  textId?: string;
  label: ReactNode;
  onClick(): void;
  disabled?: boolean;
}
export interface LaunchActionsProps {
  primary: LaunchAction;
  secondary: LaunchAction;
  /** Compact placement retains the original embedded replay row dimensions. */
  placement?: 'standard' | 'compact';
}
/** Shared play/import presentation; session and replay owners decide intent. */
export function LaunchActions({primary, secondary, placement = 'standard'}: LaunchActionsProps) {
  return <div className={`launch-wrap launch-actions${placement === 'compact' ? ' launch-actions-compact' : ''}`}>
    <button className="launch" id={primary.id} type="button" disabled={primary.disabled} onClick={primary.onClick}><span id={primary.textId}>{primary.label}</span><span className="launch-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 6 9 6-9 6Z"/></svg></span></button>
    <button className="launch launch-secondary" id={secondary.id} type="button" disabled={secondary.disabled} onClick={secondary.onClick}><span className="launch-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4M12 3v11m-4-4 4 4 4-4"/></svg></span><span id={secondary.textId}>{secondary.label}</span></button>
  </div>;
}
