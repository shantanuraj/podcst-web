import * as React from 'react';
import { useKeydown } from '../../shared/keyboard/useKeydown';

import styles from './Search.module.css';

export function Search() {
  const searchRef = React.useRef<HTMLInputElement>(null);
  const focusSearchShortcut = React.useCallback((e: KeyboardEvent) => {
    if (e.metaKey && e.key === 'k') {
      searchRef.current?.focus();
    }
  }, []);
  useKeydown(focusSearchShortcut);
  return (
    <input
      className={styles.input}
      aria-label="Search podcasts"
      type="text"
      placeholder="Search"
      ref={searchRef}
    />
  );
}
