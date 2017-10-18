/**
 * Search component for toolbar
 */

import { Component, h } from 'preact';

import { style } from 'typestyle';

import { Observable } from 'rxjs/Observable';

import { Subscription } from 'rxjs/Subscription';

import { onEvent } from '../utils';

import { Keys } from '../utils/constants';

import { ISearchState } from '../stores/search';

import SearchResults from './SearchResults';

const search = (theme: App.ITheme) =>
  style({
    padding: 16,
    height: 'inherit',
    boxShadow: 'inset 0 2px 5px rgba(0,0,0,.2)',
    backgroundColor: theme.backgroundSearch,
    border: `1px solid ${theme.backgroundSearch}`,
    outline: 'none',
    color: theme.textLight,
  });

const Key: IKeyboardShortcutsMap = {
  [Keys.s]: 'focus',
  [Keys.escape]: 'dismiss',
};

interface ISearchProps extends ISearchState {
  className: string;
  theme: App.ITheme;
  searchPodcasts(query: string);
  dismissSearch();
  navigateResult(direction: 'up' | 'down');
  focusResult(focusedResult: number);
  onResultSelect(feed: string);
}

class Search extends Component<ISearchProps, any> {
  private el: HTMLElement | null = null;
  private clicksSub: Subscription | null = null;
  private keyboardSub: Subscription | null = null;

  public componentDidMount() {
    this.watchClicks();
    this.watchKeyboard();
  }

  public componentWillUnmount() {
    this.clicksSub && this.clicksSub.unsubscribe();
    this.keyboardSub && this.keyboardSub.unsubscribe();
  }

  public watchClicks = () => {
    this.clicksSub = Observable.fromEvent(document, 'click')
      .filter(
        ({ target }: MouseEvent) =>
          !!this.el && (this.props.searching || !!this.props.query) && !this.el.contains(target as HTMLElement),
      )
      .subscribe(this.props.dismissSearch);
  };

  public watchKeyboard = () => {
    this.keyboardSub = Observable.fromEvent(document, 'keydown')
      .filter(({ keyCode }: KeyboardEvent) => Key[keyCode] !== undefined)
      .map((event: KeyboardEvent) => ({
        input: (this.el as HTMLDivElement).querySelector('input') as HTMLInputElement,
        keyCode: event.keyCode,
        preventDefault: () => event.preventDefault(),
        target: event.target as HTMLElement,
      }))
      .subscribe(({ input, keyCode, preventDefault, target }) => {
        switch (Key[keyCode]) {
          case 'focus': {
            if (this.el && !this.el.contains(target)) {
              preventDefault();
              input.focus();
            }
            return;
          }
          case 'dismiss': {
            preventDefault();
            return this.props.dismissSearch();
          }
        }
      });
  };

  public saveRef = (el: HTMLElement | undefined) => {
    if (el) {
      this.el = el;
    }
  };

  public render({
    className,
    dismissSearch,
    podcasts,
    query,
    searchPodcasts,
    focusedResult,
    focusResult,
    navigateResult,
    onResultSelect,
    theme,
  }: ISearchProps) {
    return (
      <div class={className} ref={this.saveRef}>
        <input
          aria-label="Search podcasts"
          class={search(theme)}
          type="text"
          onInput={onEvent(searchPodcasts)}
          placeholder={'Search'}
          value={query}
        />
        {query && podcasts.length ? (
          <SearchResults
            focusResult={focusResult}
            focusedResult={focusedResult}
            navigateResult={navigateResult}
            dismissSearch={dismissSearch}
            podcasts={podcasts}
            onResultSelect={onResultSelect}
            theme={theme}
          />
        ) : null}
      </div>
    );
  }
}

export default Search;
