/**
 * Episode info view
 */

import { Component, h } from 'preact';

import {
  media,
  style,
  types,
} from 'typestyle';

import {
  IPodcastsState,
} from '../stores/podcasts';

import {
  scrollToTop,
} from '../utils';

import {

} from '../utils/styles';

import Loading from './Loading';

const container = (theme: App.Theme) => style({
  color: theme.text,
  display: 'flex',
  flexDirection: 'column',
  $nest: {
    '& a': {
      color: theme.accent,
    },
  },
});

const podcastInfo = style(
  {
    display: 'flex',
    padding: 32,
  },
  media({ maxWidth: 600 }, {
    flexDirection: 'column',
    padding: 0,
  }),
);

const podcastInfoTitles = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  justifyContent: 'flex-start',
  padding: 16,
  paddingTop: 0,
});

const infoCover = (cover: string) => style(
  {
    backgroundImage: `url(${cover})`,
    backgroundPosition: 'center center',
    backgroundRepeat: 'no-repeat',
    backgroundSize: 'cover',
    width: '300px',
    height: '300px',
    minWidth: '300px',
  },
  media({ maxWidth: 600 }, {
    width: '100vw',
    height: '100vw',
  }),
);

const margins: types.NestedCSSProperties = {
  marginTop: 8,
  marginBottom: 8,
};

const infoMargins = style(margins);

const podcastTitle = style(
  margins,
  {
    fontSize: '40px',
    fontWeight: 'bold',
  },
);

const showNotesContainer = style({
  padding: 32,
  paddingTop: 0,
  fontSize: 'large',
  $nest: {
    '& *': {
      marginTop: 16,
      marginBottom: 16,
    },
  },
}, media({ maxWidth: 600 }, {
  padding: 16,
}));

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
    scrollToTop();
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
    const {
      author,
      cover,
      episodeArt,
      showNotes,
      title,
    } = episode;

    const showArt = episodeArt || cover as string;

    return (
      <div class={container(theme)}>
        <div class={podcastInfo}>
          <div
            class={infoCover(showArt)}
            role="img"
            aria-label={`${title} episode art`}
          />
          <div class={podcastInfoTitles}>
            <h1 class={podcastTitle}>
              {episode.link ? <a href={podcast.link}>{title}</a> : title}
            </h1>
            <h2 class={infoMargins}>from <a href={podcast.link}>{podcast.title}</a></h2>
            <h2 class={infoMargins}>by {author}</h2>
          </div>
        </div>
        <div
          class={showNotesContainer}
          dangerouslySetInnerHTML={{__html: showNotes}}
        />
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
