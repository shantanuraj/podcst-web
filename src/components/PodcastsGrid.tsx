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

import Loading from './Loading';
import PodcastsGridItem from './PodcastsGridItem';

const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))',
  marginBottom: '64px',
});

interface FeedStateProps extends FeedState {
  mode: 'feed';
  feed: FeedType;
  getFeed: (feed: FeedType) => void;
}

interface SubsStateProps {
  mode: 'subs';
  subs: SubscriptionsMap;
}

type PodcastsGridProps = FeedStateProps | SubsStateProps;

class PodcastsGrid extends Component<PodcastsGridProps, any> {
  componentDidMount() {
    if (this.props.mode === 'subs') {
      return;
    }

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
    return <Loading />;
  }

  renderPodcast(podcast: App.RenderablePodcast) {
    return (
      <PodcastsGridItem podcast={podcast} />
    );
  }

  renderLoaded(podcasts: App.RenderablePodcast[]) {
    return (
      <div class={grid}>
        {podcasts.map(this.renderPodcast)}
      </div>
    );
  }

  render({
    mode,
  }: PodcastsGridProps) {

    if (mode === 'feed') {
      const {
        feed,
      } = this.props as FeedStateProps;
      const {
        loading,
        podcasts,
      } = this.props[feed];

      if (loading || podcasts.length === 0) {
        return this.renderLoading();
      }

      return this.renderLoaded(podcasts);
    }

    const {
      subs,
    } = this.props as SubsStateProps;

    const podcasts = Object
      .keys(subs)
      .map(feed => ({
        ...subs[feed],
        feed,
      }));

    return this.renderLoaded(podcasts);
  }
}

export default PodcastsGrid;
