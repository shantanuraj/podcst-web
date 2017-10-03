/**
 * Episode info view
 */

import { Component, h } from 'preact';

import {
  classes,
  style,
} from 'typestyle';

import {
  IPodcastsState,
} from '../stores/podcasts';

import {
  normalizeEl,
} from '../utils/styles';

import Loading from './Loading';

const container = (theme: App.Theme) => style({
  color: theme.text,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

interface IEpisodeInfoProps {
  feed: string;
  info: IPodcastsState;
  theme: App.Theme;
  state: EpisodePlayerState;
  title: string;
  getEpisodes: (feed: string) => void;
  pauseEpisode: () => void;
  playEpisode: (episode: App.Episode) => void;
  resumeEpisode: () => void;
}

class EpisodeInfo extends Component <IEpisodeInfoProps, never> {
  public loadIfNeeded = () => {
    const {
      feed,
      getEpisodes,
      info,
    } = this.props;

    const feedInfo = info[feed];

    if (
      !feedInfo ||
      (feedInfo && !feedInfo.episodes && !feedInfo.loading)
    ) {
      getEpisodes(feed);
    }
  }

  public componentDidMount() {
    this.loadIfNeeded();
  }

  public componentDidUpdate() {
    this.loadIfNeeded();
  }

  public renderLoading() {
    return <Loading />;
  }

  public renderLoaded(
    podcast: App.EpisodeListing,
    episode: App.Episode | undefined,
  ) {
    if (!episode) {
      return (
        <div>
          Couldn't get Podcasts episode
        </div>
      );
    }

    const { theme } = this.props;

    return (
      <div class={classes(normalizeEl, container(theme))}>
        Loaded! {episode.title} by {podcast.author} from {podcast.title}
      </div>
    );
  }

  public render({
    feed,
    info,
    title,
  }: IEpisodeInfoProps) {
    const feedInfo = info[feed];
    if (!feedInfo || feedInfo.loading || !feedInfo.episodes) {
      return this.renderLoading();
    }

    const { episodes } = feedInfo.episodes;
    const currentEpisode = episodes.find((episode) => episode.title === title);

    return this.renderLoaded(feedInfo.episodes, currentEpisode);
  }
}

export default EpisodeInfo;
