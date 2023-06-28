'use client';

import React from 'react';
import { Portal } from '../../shared/portal';
import styles from './LoadBar.module.css';

export function LoadBar() {
  if (typeof window === 'undefined') return null;
  return (
    <Portal id="__next">
      <span aria-label="Loading..." className={styles.loadBar} />
    </Portal>
  );
}
