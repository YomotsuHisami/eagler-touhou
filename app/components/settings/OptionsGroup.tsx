import type {ReactNode} from 'react';

export interface OptionsGroupProps {
  id: string;
  title: ReactNode;
  open: boolean;
  onOpenChange(open: boolean): void;
  bodyClassName: string;
  children: ReactNode;
}
/** Native disclosure; the settings model remains the sole open-state owner. */
export function OptionsGroup({id, title, open, onOpenChange, bodyClassName, children}: OptionsGroupProps) {
  return <details className="options-group" id={id} open={open} onToggle={event => onOpenChange(event.currentTarget.open)}><summary className="options-group-head"><span>{title}</span><i aria-hidden="true">⌄</i></summary><div className={bodyClassName}>{children}</div></details>;
}
