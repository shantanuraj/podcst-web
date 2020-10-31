import * as React from 'react';
import styles from './Button.module.css';

export function Button({
  className,
  ...props
}: React.DetailedHTMLProps<React.ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement>) {
  const classes = className ? [className, styles.button].join(' ') : styles.button;
  return <button {...props} className={classes} />;
}
