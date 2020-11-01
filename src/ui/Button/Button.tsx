import * as React from 'react';
import styles from './Button.module.css';

export type ButtonProps = React.DetailedHTMLProps<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  HTMLButtonElement
>;

function Button({ className, ...props }: ButtonProps) {
  const classes = className ? [className, styles.button].join(' ') : styles.button;
  return <button {...props} className={classes} />;
}

const MemoizedButton = React.memo(Button);

export { MemoizedButton as Button };
