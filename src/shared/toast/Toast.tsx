import { useEffect } from 'react';

import styles from './Toast.module.css';
import { getClearToast, getMessage, toastTimeout, useToast } from './useToast';

export const Toast = () => {
  const message = useToast(getMessage);
  const clearToast = useToast(getClearToast);
  useEffect(() => {
    if (!message) return;
    const timeoutId = setTimeout(clearToast, toastTimeout);
    return () => clearTimeout(timeoutId);
  }, [message, clearToast]);
  if (!message) return null;
  return <div className={styles.toast}>{message}</div>;
};
