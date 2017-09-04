/**
 * Search component for toolbar
 */

import {
  h,
} from 'preact';

import {
  style,
} from 'typestyle';

import {
  onEvent,
} from '../utils';

import {
  SearchState,
} from '../stores/search';

import SearchResults from './SearchResults';

const search = style({
  padding: 16,
  height: 'inherit',
  boxShadow: 'inset 0 2px 5px rgba(0,0,0,.2)',
  backgroundColor: '#131313',
  border: '1px solid #131313',
  borderRadius: '4px',
  outline: 'none',
  color: 'white',
});

interface SearchProps extends SearchState {
  className: string;
  searchPodcasts: (query: string) => void;
  dismissSearch: () => void;
}

const Search = ({
  className,
  dismissSearch,
  podcasts,
  query,
  searchPodcasts,
}: SearchProps) => (
  <div class={className}>
    <input
      class={search}
      type="text"
      onInput={onEvent(searchPodcasts)}
      placeholder={'Search'}
      value={query}
    />
    {query && podcasts.length ?
      <SearchResults
        dismissSearch={dismissSearch}
        podcasts={podcasts}
      /> : null
    }
  </div>
);

export default Search;
