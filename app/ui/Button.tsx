import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import styles from './button.module.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'icon';
  asChild?: boolean;
}

/** Use asChild for links, retaining the destination's native link semantics. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', asChild = false, className = '', type = 'button', ...props }, ref,
) {
  const Component = asChild ? Slot : 'button';
  return <Component ref={ref} {...(!asChild ? { type } : {})} className={`${styles.button} ${styles[variant]} ${styles[size]} ${className}`} {...props} />;
});
