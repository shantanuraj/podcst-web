/// <reference types="react/next" />

import * as React from 'react';
import { useSearch } from '../../data/search';
import { shortcuts } from '../../shared/keyboard/shortcuts';
import { useKeydown } from '../../shared/keyboard/useKeydown';

import styles from './Search.module.css';

export function Search() {
  const [inputTerm, setTerm] = React.useState('');
  const term = React.useDeferredValue(
    inputTerm,
    // @ts-expect-error React next typings are incorrect.
    deferConfig,
  );

  const results = useSearch(term);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const focusSearchShortcut = React.useCallback(() => {
    searchRef.current?.focus();
  }, []);
  const handleInputChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setTerm(event.target.value);
  }, []);
  useKeydown(shortcuts.search, focusSearchShortcut);
  React.useEffect(() => {
    console.log(results);
  }, [results]);
  return (
    <input
      className={styles.input}
      aria-label="Search podcasts"
      type="text"
      placeholder="Search"
      onChange={handleInputChange}
      ref={searchRef}
    />
  );
}

const deferConfig = { timeoutMs: 200 };
