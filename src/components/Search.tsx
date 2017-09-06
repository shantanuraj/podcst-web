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
  Observable,
} from 'rxjs/Observable';

import {
  Subscription,
} from 'rxjs/Subscription';

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
  private el: HTMLElement | null = null;
  private dismissSub: Subscription | null = null;

  componentDidMount() {
    this.dismissSearch();
  }

  componentWillUnmount() {
    this.dismissSub && this.dismissSub.unsubscribe();
  }

  dismissSearch = () => {
    this.dismissSub = Observable.fromEvent(document, 'click')
      .filter(({ target, }: MouseEvent) =>
        !!this.el &&
        !this.el.contains(target as HTMLElement)
      )
      .subscribe(this.props.dismissSearch);
  }

  saveRef = (el: HTMLElement | undefined) => {
    if (el) {
      this.el = el;
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
