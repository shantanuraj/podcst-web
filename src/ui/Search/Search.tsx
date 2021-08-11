import * as React from 'react';
import { shortcuts } from '../../shared/keyboard/shortcuts';
import { useKeydown } from '../../shared/keyboard/useKeydown';

import styles from './Search.module.css';

export function Search() {
  const searchRef = React.useRef<HTMLInputElement>(null);
  const focusSearchShortcut = React.useCallback(() => {
    searchRef.current?.focus();
  }, []);
  useKeydown(shortcuts.search, focusSearchShortcut);
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
