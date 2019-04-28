/**
 * Podcasts grid component
 */

import * as React from 'react';

import { style } from 'typestyle';

import { App, FeedType } from '../typings';

import Loading from './Loading';

import PodcastsGridItem from './PodcastsGridItem';

const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))',
});

interface IPodcastsGridProps {
  themeMode: App.ThemeMode;
  podcasts: App.RenderablePodcast[];
  loading: boolean;
  feed?: FeedType;
  getFeed?: (feed: FeedType) => void;
}

class PodcastsGrid extends React.PureComponent<IPodcastsGridProps, never> {
  public componentDidMount() {
    const { feed, getFeed, loading, podcasts } = this.props;
    if (!loading && podcasts.length === 0 && feed && getFeed) {
      getFeed(feed);
    }
  }

  public renderLoading() {
    return <Loading />;
  }

  public renderPodcast = (mode: App.ThemeMode) => (podcast: App.RenderablePodcast) => {
    return <PodcastsGridItem key={podcast.feed} mode={mode} podcast={podcast} />;
  };

  public renderLoaded(mode: App.ThemeMode, podcasts: App.RenderablePodcast[]) {
    return <div className={grid}>{podcasts.map(this.renderPodcast(mode))}</div>;
  }

  public render() {
    const { loading, podcasts, themeMode } = this.props;

    return loading || podcasts.length === 0 ? this.renderLoading() : this.renderLoaded(themeMode, podcasts);
  }
}

export default PodcastsGrid;
