/// <reference types="react/next" />

import { useCombobox, UseComboboxStateChange } from 'downshift';
import router from 'next/router';
import * as React from 'react';
import { useSearch } from '../../data/search';
import { shortcuts } from '../../shared/keyboard/shortcuts';
import { useKeydown } from '../../shared/keyboard/useKeydown';
import { IPodcastSearchResult } from '../../types';

import styles from './Search.module.css';

export function Search() {
  const [inputTerm, setTerm] = React.useState('');
  const term = React.useDeferredValue(
    inputTerm,
    // @ts-expect-error React next typings are incorrect.
    deferConfig,
  );

  const searchRef = React.useRef<HTMLInputElement>(null);
  const focusSearchShortcut = React.useCallback(() => {
    searchRef.current?.focus();
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

  const { isOpen, getMenuProps, getInputProps, getComboboxProps, highlightedIndex, getItemProps } =
    useCombobox({
      items: searchResults,
      onInputValueChange,
      itemToString: serealizeSearchResult,
      onSelectedItemChange: onSelectionChange,
    });

  return (
    <div {...getComboboxProps()} className={styles.search}>
      <input
        {...getInputProps({ ref: searchRef })}
        // className={styles.input}
        aria-label="Search podcasts"
        type="text"
        placeholder="Search"
      />
      <ul {...getMenuProps()} className={styles.results}>
        {isOpen &&
          searchResults.map((item, index) => (
            <li
              className={styles.searchItem}
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
    <React.Fragment>
      <img loading="lazy" alt={`${podcast.title} by ${podcast.author}`} src={podcast.thumbnail} />
      <div>
        <p className={styles.title}>{podcast.title}</p>
        <p className={styles.author}>{podcast.author}</p>
      </div>
    </React.Fragment>
  );
};

const deferConfig = { timeoutMs: 200 };
const emptyResult: IPodcastSearchResult[] = [];
const serealizeSearchResult = (item: IPodcastSearchResult | null) => {
  return item?.title || '';
};
const onSelectionChange = (changes: UseComboboxStateChange<IPodcastSearchResult>) => {
  if (!changes.selectedItem) return;
  router.push(`/episodes?feed=${changes.selectedItem.feed}`);
};
