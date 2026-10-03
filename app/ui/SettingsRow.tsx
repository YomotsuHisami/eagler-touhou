import { useId, type ReactNode } from 'react';
import * as Switch from '@radix-ui/react-switch';
import styles from './settings.module.css';

export interface SettingsRowProps {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}

export function SettingsRow({ label, description, children, htmlFor, className = '' }: SettingsRowProps) {
  return <div className={`${styles.row} ${className}`}><div className={styles.copy}>
    {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className={styles.label}>{label}</span>}
    {description && <p className={styles.description}>{description}</p>}
  </div><div className={styles.control}>{children}</div></div>;
}

export interface SettingsSwitchProps {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}

export function SettingsSwitch({ label, description, checked, onCheckedChange, disabled, id }: SettingsSwitchProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const descriptionId = `${controlId}-description`;
  return <div className={styles.row}><div className={styles.copy}>
    <label htmlFor={controlId}>{label}</label>
    {description && <p id={descriptionId} className={styles.description}>{description}</p>}
  </div><Switch.Root id={controlId} className={styles.switch} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-describedby={description ? descriptionId : undefined}>
    <Switch.Thumb className={styles.thumb} />
  </Switch.Root></div>;
}

export function SettingsGroup({ title, description, children }: { title: ReactNode; description?: ReactNode; children: ReactNode }) {
  const titleId = useId();
  return <section className={styles.group} aria-labelledby={titleId}><header className={styles.heading}><h3 id={titleId}>{title}</h3>{description && <p>{description}</p>}</header><div>{children}</div></section>;
}
