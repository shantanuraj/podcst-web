/**
 * Podcasts grid component
 */

import {
  h,
  Component,
} from 'preact';

import {
  FeedState,
} from '../stores/feed';

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

  renderLoaded(podcasts: App.Podcast[]) {
    return (
      <div>
        Got {podcasts.length} podcasts
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
