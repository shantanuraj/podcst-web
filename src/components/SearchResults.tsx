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
  boxShadow: '0px 15px 20px 0px rgba(0,0,0,0.75)',
  overflow: 'scroll',
});

const result = style({
  display: 'flex',
  $nest: {
    '&:hover, &:focus, &[data-focus]': {
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
  dismissSearch: () => void;
  navigateResult: (direction: 'up' | 'down') => void;
}

const Key: KeyboardShortcutsMap = {
  38: 'up',
  40: 'down',
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
            case 'down':
              this.props.navigateResult(Key[e.keyCode] as 'up' | 'down');
          }
        });
      }
    }
  }

  renderPodcast = (
    podcast: App.Podcast,
    isFocussed: boolean,
    dismissSearch: SearchResultsProps['dismissSearch'],
  ) => (
    <Link
      onClick={dismissSearch}
      href={`/episodes?feed=${podcast.feed}`}
    >
      <div data-focus={isFocussed} class={result}>
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
    dismissSearch: SearchResultsProps['dismissSearch'],
  ) => (
    podcasts.map((podcast, i) => this.renderPodcast(
      podcast,
      focusedResult === i,
      dismissSearch
    ))
  )

  render({
    dismissSearch,
    focusedResult,
    podcasts,
  }: SearchResultsProps) {
    return (
      <div
        class={results}
        onClick={dismissSearch}
        ref={el => this.el = el as HTMLDivElement}
      >
        {this.renderPodcasts(podcasts, focusedResult, dismissSearch)}
      </div>
    );
  }
}

export default SearchResults;
