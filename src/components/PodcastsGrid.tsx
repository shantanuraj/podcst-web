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

  }

  render() {
    return (
      <div>
        Hello
      </div>
    );
  }
}

export default PodcastsGrid;
