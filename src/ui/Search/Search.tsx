'use client';

import { useCombobox, UseComboboxStateChange } from 'downshift';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { useSearch } from '../../data/search';
import { shortcuts } from '../../shared/keyboard/shortcuts';
import { useKeydown } from '../../shared/keyboard/useKeydown';
import { IPodcastSearchResult } from '../../types';
import { LoadBar } from '../LoadBar';

import styles from './Search.module.css';

export function Search() {
  const router = useRouter();
  const onSelectionChange = React.useCallback(
    (changes: UseComboboxStateChange<IPodcastSearchResult>) => {
      if (!changes.selectedItem) return;
      router.push(`/episodes/${encodeURIComponent(changes.selectedItem.feed)}`);
    },
    [router],
  );
  const [inputTerm, setTerm] = React.useState('');
  const term = React.useDeferredValue(
    inputTerm,
    // @ts-expect-error React next typings are incorrect.
    deferConfig,
  );

  const searchRef = React.useRef<HTMLInputElement>(null);
  const focusSearchShortcut = React.useCallback(() => {
    // Schedule focus on next frame to avoid entering the shortcut into the input
    requestAnimationFrame(() => {
      searchRef.current?.focus();
    });
  }, []);
  useKeydown(shortcuts.search, focusSearchShortcut);

  const response = useSearch(term);
  const searchResults = response.data || emptyResult;

  const onInputValueChange = React.useCallback(
    (changes: UseComboboxStateChange<IPodcastSearchResult>) => {
      setTerm(changes.inputValue || '');
    },
    [],
  );

  const { isOpen, getMenuProps, getInputProps, highlightedIndex, getItemProps } = useCombobox({
    items: searchResults,
    onInputValueChange,
    itemToString: serealizeSearchResult,
    onSelectedItemChange: onSelectionChange,
    id: 'search',
    inputId: 'search',
  });

  return (
    <div className={styles.search}>
      {response.isValidating && <LoadBar />}
      <input
        {...getInputProps({ ref: searchRef })}
        aria-label="Search podcasts"
        type="text"
        placeholder="Search"
      />
      <ul {...getMenuProps()} className={styles.results}>
        {isOpen &&
          Array.isArray(searchResults) &&
          searchResults.map((item, index) => (
            <li
              data-highlighted={highlightedIndex === index}
              key={item.feed}
              {...getItemProps({ item, index })}
            >
              <SearchResult podcast={item} />
            </li>
          ))}
      </ul>
    </div>
  );
}

const SearchResult: React.FC<{ podcast: IPodcastSearchResult }> = ({ podcast }) => {
  return (
    <Link href={`/episodes/${encodeURIComponent(podcast.feed)}`} className={styles.searchItem}>
      <img loading="lazy" alt={`${podcast.title} by ${podcast.author}`} src={podcast.thumbnail} />
      <div>
        <p className={styles.title}>{podcast.title}</p>
        <p className={styles.author}>{podcast.author}</p>
      </div>
    </Link>
  );
};

const deferConfig = { timeoutMs: 200 };
const emptyResult: IPodcastSearchResult[] = [];
const serealizeSearchResult = (item: IPodcastSearchResult | null) => {
  return item?.title || '';
};
