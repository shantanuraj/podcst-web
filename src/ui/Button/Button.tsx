import * as React from 'react';
import styles from './Button.module.css';

export interface ButtonProps extends React.ComponentProps<'button'> {}

export const Button = React.memo(
  React.forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, ...props }, ref) {
    const classes = className ? [className, styles.button].join(' ') : styles.button;
    return <button {...props} className={classes} ref={ref} />;
  }),
);

Button.displayName = 'Button';