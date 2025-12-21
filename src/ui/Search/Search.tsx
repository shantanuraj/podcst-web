'use client';

import { useCombobox, UseComboboxStateChange } from 'downshift';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { useSearch } from '@/data/search';
import { shortcuts } from '@/shared/keyboard/shortcuts';
import { useKeydown } from '@/shared/keyboard/useKeydown';
import { IPodcastSearchResult } from '@/types';
import { LoadBar } from '@/ui/LoadBar';

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
  const term = React.useDeferredValue(inputTerm);
  const { data: searchResults = emptyResult, isFetching } = useSearch(term);

  const searchRef = React.useRef<HTMLInputElement>(null);
  const focusSearchShortcut = React.useCallback(() => {
    // Schedule focus on next frame to avoid entering the shortcut into the input
    requestAnimationFrame(() => {
      searchRef.current?.focus();
    });
  }, []);
  useKeydown(shortcuts.search, focusSearchShortcut);

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
      {isFetching && <LoadBar />}
      <input
        {...getInputProps({ ref: searchRef })}
        aria-label="Search podcasts"
        type="text"
        placeholder="Search podcasts..."
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

const emptyResult: IPodcastSearchResult[] = [];
const serealizeSearchResult = (item: IPodcastSearchResult | null) => {
  return item?.title || '';
};
