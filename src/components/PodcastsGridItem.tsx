/**
 * Podcasts Grid Item
 */

import {
  h,
} from 'preact';

import {
  style,
} from 'typestyle';

const gridItem = cover => style({
  height: '200px',
  backgroundImage: `url(${cover})`,
  backgroundRepeat: 'no-repeat',
  backgroundSize: 'cover',
});

const PodcastsGridItem = (podcast: App.Podcast) => {
  const {
    author,
    title,
  } = podcast;
  return (
    <div
      role="img"
      aria-label={`${title} by ${author}`}
      class={gridItem(podcast.cover)}
    >
    </div>
  );
}

export default PodcastsGridItem;
