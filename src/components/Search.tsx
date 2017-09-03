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
}

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
});

const resultImage = style({
  height: '50px',
  width: '50px',
});

const resultText = style({
  paddingLeft: 8,
  fontSize: 16,
});

const resultAuthorText = style({
  marginTop: 8,
  fontSize: 12,
});

const renderPodcast = (podcast: App.Podcast) => (
  <div class={result}>
    <img class={resultImage} src={podcast.thumbnail} />
    <div class={resultText}>
      <p>{podcast.title}</p>
      <p class={resultAuthorText}>{podcast.author}</p>
    </div>
  </div>
);

const renderPodcasts = (podcasts: App.Podcast[]) => (
  podcasts.map(renderPodcast)
);

const Search = ({
  className,
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
    {
      query && podcasts.length ?
        <div class={results}>
          {renderPodcasts(podcasts)}
        </div> :
        null
    }
  </div>
);

export default Search;
