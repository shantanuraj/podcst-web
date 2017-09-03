/**
 * Search results component
 */

import {
  h,
} from 'preact';

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
    '&:hover': {
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

const renderPodcast = (podcast: App.Podcast) => (
  <div class={result}>
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
);

interface SearchResultsProps {
  podcasts: App.Podcast[];
}

const SearchResults = ({
  podcasts,
}: SearchResultsProps) => (
  <div class={results}>
    {podcasts.map(renderPodcast)}
  </div>
);

export default SearchResults;
