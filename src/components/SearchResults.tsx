/**
 * Search results component
 */

import {
  Observable,
} from 'rxjs/Observable'

import {
  Subscription,
} from 'rxjs/Subscription'

import {
  h,
  Component,
} from 'preact';

import {
  Link,
} from 'preact-router';

import {
  style,
} from 'typestyle';

const results = style({
  backgroundColor: '#292929',
  position: 'absolute',
  maxHeight: '500px',
  width: '100%',
  boxShadow: '0px 15px 20px 0px rgba(0,0,0,0.75)',
  overflow: 'scroll',
});

const result = style({
  display: 'flex',
  $nest: {
    '&[data-focus]': {
      backgroundColor: 'white',
      color: 'black',
    },
  },
});

const resultImage = style({
  height: '50px',
  width: '50px',
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

interface SearchResultsProps {
  podcasts: App.Podcast[];
  focusedResult: number;
  dismissSearch();
  navigateResult(direction: 'up' | 'down');
  focusResult(focusedResult: number);
  onResultSelect(feed: string);
}

const Key: KeyboardShortcutsMap = {
  38: 'up',
  40: 'down',
  13: 'select',
};

class SearchResults extends Component<SearchResultsProps, any> {

  el: HTMLDivElement | null;
  navigationSub: Subscription | null;

  componentDidMount() {
    this.watchKeyboard();
  }

  componentWillUnmount() {
    this.navigationSub && this.navigationSub.unsubscribe();
  }

  watchKeyboard() {
    if (this.el) {
      const parent = this.el.parentElement;
      if (parent) {
        this.navigationSub = Observable.fromEvent(parent, 'keydown')
        .filter(({ keyCode }: KeyboardEvent) => Key[keyCode] !== undefined)
        .subscribe((e: KeyboardEvent) => {
          e.preventDefault();
          switch (Key[e.keyCode]) {
            case 'up':
            case 'down': {
              return this.props.navigateResult(
                Key[e.keyCode] as 'up' | 'down'
              );
            }
            case 'select': {
              const {
                podcasts,
                focusedResult,
                onResultSelect,
                dismissSearch,
              } = this.props;
              const selectedPodcast = podcasts[focusedResult];
              return (
                onResultSelect(selectedPodcast.feed),
                dismissSearch()
              );
            }
          }
        });
      }
    }
  }

  renderPodcast = (
    podcast: App.Podcast,
    isFocussed: boolean,
    focusResult: () => void,
    dismissSearch: SearchResultsProps['dismissSearch'],
  ) => (
    <Link
      onClick={dismissSearch}
      href={`/episodes?feed=${podcast.feed}`}
    >
      <div
        class={result}
        data-focus={isFocussed}
        onMouseEnter={focusResult}
      >
        <img class={resultImage} src={podcast.thumbnail} />
        <div class={resultText}>
          <p
            class={resultPodcastTitle}
            title={podcast.title}
          >
            {podcast.title}
          </p>
          <p
            class={resultAuthorText}
            title={podcast.author}
          >
            {podcast.author}
          </p>
        </div>
      </div>
    </Link>
  )

  renderPodcasts = (
    podcasts: App.Podcast[],
    focusedResult: number,
    focusResult: SearchResultsProps['focusResult'],
    dismissSearch: SearchResultsProps['dismissSearch'],
  ) => (
    podcasts.map((podcast, i) => this.renderPodcast(
      podcast,
      focusedResult === i,
      () => focusResult(i),
      dismissSearch
    ))
  )

  render({
    dismissSearch,
    focusResult,
    focusedResult,
    podcasts,
  }: SearchResultsProps) {
    return (
      <div
        class={results}
        onClick={dismissSearch}
        ref={el => this.el = el as HTMLDivElement}
      >
        {this.renderPodcasts(podcasts, focusedResult, focusResult, dismissSearch)}
      </div>
    );
  }
}

export default SearchResults;
