'use client';

import { useEffect } from 'react';

import styles from './Toast.module.css';
import {
  actionToastTimeout,
  getAction,
  getClearToast,
  getMessage,
  toastTimeout,
  useToast,
} from './useToast';

export const Toast = () => {
  const message = useToast(getMessage);
  const action = useToast(getAction);
  const clearToast = useToast(getClearToast);
  useEffect(() => {
    if (!message) return;
    const timeoutId = setTimeout(
      clearToast,
      action ? actionToastTimeout : toastTimeout,
    );
    return () => clearTimeout(timeoutId);
  }, [message, action, clearToast]);
  if (!message) return null;
  return (
    <div className={styles.toast} role="status" data-action={!!action}>
      {message}
      {action && (
        <button
          type="button"
          onClick={() => {
            action.run();
            clearToast();
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
};
