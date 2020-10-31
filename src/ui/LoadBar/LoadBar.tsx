import React from 'react';
import styles from './LoadBar.module.css';

export function LoadBar() {
  return <span aria-label="Loading..." className={styles.loadBar} />;
}
