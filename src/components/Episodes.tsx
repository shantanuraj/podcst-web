import { h, Component } from 'preact';

import {
  PodcastsState,
} from '../stores/podcasts';

interface EpisodesProps {
  feed: string;
  info: PodcastsState;
  getEpisodes: (feed: string) => void;
}

class Episodes extends Component<EpisodesProps, any> {
  componentDidMount() {
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

  renderLoading() {
    return (
      <div>
        Loading...
      </div>
    );
  }

  renderLoaded(info: App.EpisodeListing | null) {
    if (!info) {
      return (
        <div>
          Couldn't get Podcasts episodes
        </div>
      );
    }

    return (
      <div>
        Fetched {info.episodes.length} episodes
      </div>
    );
  }

  render({
    feed,
    info,
  }: EpisodesProps) {
    const feedInfo = info[feed];
    if (!feedInfo || feedInfo.loading) {
      return this.renderLoading();
    }

    return this.renderLoaded(feedInfo.episodes);
  }
}

export default Episodes;
