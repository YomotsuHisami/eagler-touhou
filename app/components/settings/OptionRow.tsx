import type {ReactNode} from 'react';

export interface OptionRowProps {
  className: string;
  id?: string;
  hidden?: boolean;
  label: ReactNode;
  hint?: ReactNode;
  hintId?: string;
  /** thprac's original label is inline text rather than a nested label span. */
  inlineLabel?: boolean;
  control: ReactNode;
}
/** Common toggle-row presentation; capability and mutation policy stay outside. */
export function OptionRow({className, id, hidden, label, hint, hintId, inlineLabel = false, control}: OptionRowProps) {
  return <section className={className} id={id} hidden={hidden}><div className="itemtop"><span>{hint === undefined || inlineLabel ? label : <span>{label}</span>}{hint !== undefined && <small id={hintId}>{hint}</small>}</span>{control}</div></section>;
}
