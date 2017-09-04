/**
 * Search component for toolbar
 */

import {
  h,
  Component,
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

class Search extends Component<SearchProps, any> {
  private el: HTMLElement | null;

  componentDidMount() {
    document.addEventListener('click', this.dismissSearch);
  }

  componentWillUnmount() {
    document.removeEventListener('click', this.dismissSearch);
  }

  saveRef = (el: HTMLElement | undefined) => {
    if (el) {
      this.el = el;
    }
  }

  dismissSearch = (e: MouseEvent) => {
    const {
      dismissSearch,
    } = this.props;
    const target = e.target as HTMLElement;
    if (this.el && !this.el.contains(target)) {
      dismissSearch();
    }
  }

  render({
    className,
    dismissSearch,
    podcasts,
    query,
    searchPodcasts,
  }: SearchProps) {
    return (
      <div
        class={className}
        ref={this.saveRef}
      >
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
  }
}

export default Search;
