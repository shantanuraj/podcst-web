'use client';

import { type UseComboboxStateChange, useCombobox } from 'downshift';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { useSearch } from '@/data/search';
import { useTranslation } from '@/shared/i18n';
import { shortcuts } from '@/shared/keyboard/shortcuts';
import { useKeydown } from '@/shared/keyboard/useKeydown';
import type { IPodcastSearchResult } from '@/types';
import { ProxiedImage } from '@/ui/Image';
import { LoadBar } from '@/ui/LoadBar';

import styles from './Search.module.css';

function getSearchResultHref(result: IPodcastSearchResult): string {
  if (result.id) {
    return `/itunes/${result.id}`;
  }
  return `/episodes/${encodeURIComponent(result.feed)}`;
}

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
  const term = React.useDeferredValue(inputTerm);
  const { data: searchResults = emptyResult, isFetching } = useSearch(term);

  const searchRef = React.useRef<HTMLInputElement>(null);
  const focusSearchShortcut = React.useCallback(() => {
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
    <div className={styles.search}>
      {isFetching && <LoadBar />}
      <input
        {...getInputProps({ ref: searchRef })}
        aria-label={t('search.label')}
        type="text"
        placeholder={t('search.placeholder')}
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

const SearchResult: React.FC<{ podcast: IPodcastSearchResult }> = ({
  podcast,
}) => {
  return (
    <Link href={getSearchResultHref(podcast)} className={styles.searchItem}>
      <ProxiedImage
        loading="lazy"
        alt={`${podcast.title} by ${podcast.author}`}
        src={podcast.thumbnail}
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
