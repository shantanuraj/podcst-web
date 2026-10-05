'use client';

import { type UseComboboxStateChange, useCombobox } from 'downshift';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { useSearch } from '@/data/search';
import { useTranslation } from '@/shared/i18n';
import { shortcuts } from '@/shared/keyboard/shortcuts';
import { useKeydown } from '@/shared/keyboard/useKeydown';
import { getSearchResultHref } from '@/shared/links';
import type { IPodcastSearchResult } from '@/types';
import { ProxiedImage } from '@/ui/Image';
import { LoadBar } from '@/ui/LoadBar';

import styles from './Search.module.css';

export function Search() {
  const router = useRouter();
  const { t } = useTranslation();
  const onSelectionChange = React.useCallback(
    (changes: UseComboboxStateChange<IPodcastSearchResult>) => {
      if (!changes.selectedItem) return;
      router.push(getSearchResultHref(changes.selectedItem));
    },
    [router],
  );
  const [inputTerm, setTerm] = React.useState('');
  const [debouncedTerm, setDebouncedTerm] = React.useState('');

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(inputTerm), 300);
    return () => clearTimeout(timer);
  }, [inputTerm]);

  const {
    data: searchResults = emptyResult,
    isFetching,
    needsSignIn,
    error,
  } = useSearch(debouncedTerm);

  const searchRef = React.useRef<HTMLInputElement>(null);
  const focusSearchShortcut = React.useCallback((event: KeyboardEvent) => {
    event.preventDefault();
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

  const {
    isOpen,
    getMenuProps,
    getInputProps,
    highlightedIndex,
    getItemProps,
  } = useCombobox({
    items: searchResults,
    onInputValueChange,
    itemToString: serealizeSearchResult,
    onSelectedItemChange: onSelectionChange,
    id: 'search',
    inputId: 'search',
  });

  return (
    <div className={styles.search} data-query={inputTerm.length > 0}>
      {isFetching && <LoadBar />}
      <svg viewBox="0 0 24 24" className={styles.icon} aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-4-4" />
      </svg>
      <input
        {...getInputProps({
          ref: searchRef,
          onKeyDown: (event) => {
            if (event.key !== 'Enter' || highlightedIndex !== -1) return;
            const term = inputTerm.trim();
            if (!term) return;
            event.preventDefault();
            searchRef.current?.blur();
            router.push(`/search?q=${encodeURIComponent(term)}`);
          },
        })}
        aria-label={t('search.label')}
        type="search"
        placeholder={t('search.placeholder')}
      />
      <kbd className={styles.hint}>{shortcuts.search.displayKey}</kbd>
      <ul {...getMenuProps()} className={styles.results}>
        {isOpen && needsSignIn && (
          <li>
            <Link href="/auth">Sign in to open an RSS link</Link>
          </li>
        )}
        {isOpen && error && (
          <li role="status">Feed unavailable. Please try again.</li>
        )}
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

const SearchResult: React.FC<{ podcast: IPodcastSearchResult }> = ({
  podcast,
}) => {
  return (
    <Link
      href={getSearchResultHref(podcast)}
      prefetch={false}
      className={styles.searchItem}
    >
      <ProxiedImage
        loading="lazy"
        alt={`${podcast.title} by ${podcast.author}`}
        src={podcast.cover}
        privateSource={podcast.isPrivate}
        sizes="56px"
      />
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
