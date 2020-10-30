import * as React from 'react';

import styles from './Search.module.css';

export function Search() {
  return (
    <input className={styles.input} aria-label="Search podcasts" type="text" placeholder="Search" />
  );
}
