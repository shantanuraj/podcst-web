/**
 * Search results component
 */

import { Observable } from 'rxjs/Observable';

import { Subscription } from 'rxjs/Subscription';

import { Component, h } from 'preact';

import { Link } from 'preact-router';

import { media, style } from 'typestyle';

import { Keys } from '../utils/constants';

const results = (theme: App.ITheme) =>
  style(
    {
      backgroundColor: theme.background,
      position: 'absolute',
      right: 0,
      width: '30%',
      maxHeight: '500px',
      boxShadow: '0px 15px 20px 0px rgba(0,0,0,0.75)',
      overflow: 'scroll',
    },
    media(
      { maxWidth: 600 },
      {
        width: '75%',
      },
    ),
  );

const result = (theme: App.ITheme) =>
  style({
    display: 'flex',
    $nest: {
      '&[data-focus]': {
        backgroundColor: theme.backgroundLight,
      },
    },
  });

const resultImage = (mode: App.ThemeMode) =>
  style({
    height: 50,
    width: 50,
    minHeight: 50,
    minWidth: 50,
    backgroundImage: `url(/icons/launcher-${mode}.svg)`,
    backgroundPosition: 'center center',
    backgroundRepeat: 'no-repeat',
  });

const resultText = style({
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  paddingLeft: 8,
  textOverflow: 'ellipsis',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
});

const resultPodcastTitle = style({
  fontSize: 12,
  fontWeight: 'bold',
});

const resultAuthorText = style({
  marginTop: 8,
  fontSize: 12,
  fontWeight: 300,
});

interface ISearchResultsProps {
  podcasts: App.IPodcastSearchResult[];
  focusedResult: number;
  theme: App.ITheme;
  mode: App.ThemeMode;
  dismissSearch();
  navigateResult(direction: 'up' | 'down');
  focusResult(focusedResult: number);
  onResultSelect(feed: string);
}

const SearchNavKeys: IKeyboardShortcutsMap = {
  [Keys.up]: 'up',
  [Keys.down]: 'down',
  [Keys.enter]: 'select',
};

class SearchResults extends Component<ISearchResultsProps, any> {
  public el: HTMLDivElement | null;
  public navigationSub: Subscription | null;

  public componentDidMount() {
    this.watchKeyboard();
  }

  public componentWillUnmount() {
    this.navigationSub && this.navigationSub.unsubscribe();
  }

  public watchKeyboard() {
    if (this.el) {
      const parent = this.el.parentElement;
      if (parent) {
        this.navigationSub = Observable.fromEvent(parent, 'keydown')
          .filter(({ keyCode }: KeyboardEvent) => SearchNavKeys[keyCode] !== undefined)
          .subscribe((e: KeyboardEvent) => {
            e.preventDefault();
            const clicked = SearchNavKeys[e.keyCode];
            switch (clicked) {
              case 'up':
              case 'down':
                return this.props.navigateResult(clicked);
              case 'select':
                const { podcasts, focusedResult, onResultSelect, dismissSearch } = this.props;
                const selectedPodcast = podcasts[focusedResult];
                return onResultSelect(selectedPodcast.feed), dismissSearch();
            }
          });
      }
    }
  }

  public renderPodcast = (
    podcast: App.IPodcastSearchResult,
    isFocussed: boolean,
    focusResult: () => void,
    dismissSearch: ISearchResultsProps['dismissSearch'],
    mode: ISearchResultsProps['mode'],
    theme: ISearchResultsProps['theme'],
  ) => (
    <Link onClick={dismissSearch} href={`/episodes?feed=${podcast.feed}`}>
      <div class={result(theme)} data-focus={isFocussed} onMouseEnter={focusResult}>
        <img class={resultImage(mode)} src={podcast.thumbnail} />
        <div class={resultText}>
          <p class={resultPodcastTitle} title={podcast.title}>
            {podcast.title}
          </p>
          <p class={resultAuthorText} title={podcast.author}>
            {podcast.author}
          </p>
        </div>
      </div>
    </Link>
  );

  public renderPodcasts = (
    podcasts: App.IPodcastSearchResult[],
    focusedResult: number,
    focusResult: ISearchResultsProps['focusResult'],
    dismissSearch: ISearchResultsProps['dismissSearch'],
    mode: ISearchResultsProps['mode'],
    theme: ISearchResultsProps['theme'],
  ) =>
    podcasts.map((podcast, i) =>
      this.renderPodcast(podcast, focusedResult === i, () => focusResult(i), dismissSearch, mode, theme),
    );

  public render({ dismissSearch, focusResult, focusedResult, mode, podcasts, theme }: ISearchResultsProps) {
    return (
      <div class={results(theme)} onClick={dismissSearch} ref={el => (this.el = el as HTMLDivElement)}>
        {this.renderPodcasts(podcasts, focusedResult, focusResult, dismissSearch, mode, theme)}
      </div>
    );
  }
}

export default SearchResults;
