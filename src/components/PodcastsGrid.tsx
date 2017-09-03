/**
 * Podcasts grid component
 */

import {
  h,
  Component,
} from 'preact';

import {
  style,
} from 'typestyle';

import {
  FeedState,
} from '../stores/feed';

const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))',
});

const gridItem = cover => style({
  height: '200px',
  backgroundImage: `url(${cover})`,
  backgroundRepeat: 'no-repeat',
  backgroundSize: 'cover',
});

interface PodcastsGridProps extends FeedState {
  feed: FeedType;
  getFeed: (feed: FeedType) => void;
}

class PodcastsGrid extends Component<PodcastsGridProps, any> {
  componentDidMount() {
    const {
      feed,
      getFeed,
    } = this.props;
    const {
      loading,
      podcasts,
    } = this.props[feed];

    if (!loading && podcasts.length === 0) {
      getFeed(feed);
    }
  }

  renderLoading() {
    return (
      <div>
        Loading...
      </div>
    );
  }

  renderPodcast(podcast: App.Podcast) {
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

  renderLoaded(podcasts: App.Podcast[]) {
    return (
      <div class={grid}>
        {podcasts.map(this.renderPodcast)}
      </div>
    );
  }

  render({
    feed,
  }: PodcastsGridProps) {
    const {
      loading,
      podcasts,
    } = this.props[feed];

    if (loading || podcasts.length === 0) {
      return this.renderLoading();
    }

    return this.renderLoaded(podcasts);
  }
}

export default PodcastsGrid;
