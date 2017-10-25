/**
 * Podcasts grid component
 */

import { Component, h } from 'preact';

import { style } from 'typestyle';

import { IFeedData, IFeedState } from '../stores/feed';

import Loading from './Loading';
import PodcastsGridItem from './PodcastsGridItem';

const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))',
});

interface IFeedStateProps extends IFeedState {
  mode: 'feed';
  themeMode: App.ThemeMode;
  feed: FeedType;
  getFeed: (feed: FeedType) => void;
}

interface ISubsStateProps {
  mode: 'subs';
  themeMode: App.ThemeMode;
  subs: ISubscriptionsMap;
}

type PodcastsGridProps = IFeedStateProps | ISubsStateProps;

class PodcastsGrid extends Component<PodcastsGridProps, any> {
  public componentDidMount() {
    if (this.props.mode === 'subs') {
      return;
    }

    const { feed, getFeed } = this.props;
    const { loading, podcasts } = this.props[feed];

    if (!loading && podcasts.length === 0) {
      getFeed(feed);
    }
  }

  public renderLoading() {
    return <Loading />;
  }

  public renderPodcast = (mode: App.ThemeMode) => (podcast: App.RenderablePodcast) => {
    return <PodcastsGridItem mode={mode} podcast={podcast} />;
  };

  public renderLoaded(mode: App.ThemeMode, podcasts: App.RenderablePodcast[]) {
    return <div class={grid}>{podcasts.map(this.renderPodcast(mode))}</div>;
  }

  public render({ mode, themeMode }: PodcastsGridProps) {
    if (mode === 'feed') {
      const { feed } = this.props as IFeedStateProps;
      const { loading, podcasts } = this.props[feed] as IFeedData;

      if (loading || podcasts.length === 0) {
        return this.renderLoading();
      }

      return this.renderLoaded(themeMode, podcasts);
    }

    const { subs } = this.props as ISubsStateProps;

    const renderablePodcasts = Object.keys(subs).map(feed => ({
      ...subs[feed],
      feed,
    }));

    return this.renderLoaded(themeMode, renderablePodcasts);
  }
}

export default PodcastsGrid;
