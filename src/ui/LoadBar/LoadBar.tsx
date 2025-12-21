'use client';

import { Portal } from '@/shared/portal';
import styles from './LoadBar.module.css';

export function LoadBar() {
  return (
    <Portal id="__next">
      <span aria-label="Loading..." className={styles.loadBar} />
    </Portal>
  );
}
