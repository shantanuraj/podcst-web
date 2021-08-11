import * as React from 'react';
import { shortcuts } from '../../shared/keyboard/shortcuts';
import { isMatchingEvent, useKeydown } from '../../shared/keyboard/useKeydown';

import styles from './Search.module.css';

export function Search() {
  const searchRef = React.useRef<HTMLInputElement>(null);
  const focusSearchShortcut = React.useCallback((e: KeyboardEvent) => {
    if (isMatchingEvent(e, shortcuts.search)) {
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
