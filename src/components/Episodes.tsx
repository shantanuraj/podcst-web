import { h, Component } from 'preact';
import {
  media,
  style,
  types,
} from 'typestyle';

import {
  PodcastsState,
} from '../stores/podcasts';

import {
  scrollToTop,
  stripHost,
} from '../utils';

import {
  normalizeEl,
} from '../utils/styles';

import Loading from './Loading';
import Episode from './Episode';

const episodesContainer = (theme: App.Theme) => style({
  backgroundColor: theme.background,
  color: theme.text,
});

const infoCover = (cover: string) => style(
  {
    backgroundImage: `url(${cover})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: 'cover',
    width: '300px',
    height: '300px',
    minWidth: '300px',
  },
  media({
    maxWidth: 601,
  }, {
    width: '100vw',
    height: '100vw',
  }),
);

const podcastInfo = style(
  {
    display: 'flex',
  },
  media({
    maxWidth: 601,
  }, {
    flexDirection: 'column',
  }),
);

const podcastInfoTitles = (theme: App.Theme) => style({
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  padding: 16,
  paddingTop: 8,
  $nest: {
    '& a': {
      color: theme.accent,
    },
  },
});

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

const subscribeButton = (theme: App.Theme) => style({
  display: 'inline-block',
  minWidth: '120px',
  borderRadius: '3px',
  padding: '8px',
  background: 'transparent',
  color: 'white',
  border: '2px solid #82ffb5',
  outline: 0,
  $nest: {
    '&:focus, &:hover, &[data-is-subscribed]': {
      backgroundColor: theme.accent,
      color: theme.background,
    },
    '&[data-is-subscribed]:hover': {
      background: 'transparent',
      color: theme.text,
    },
  },
});

const episodesView = style({
  paddingTop: 32,
  paddingBottom: 32,
});

interface EpisodesProps {
  theme: App.Theme;
  feed: string;
  info: PodcastsState;
  state: EpisodePlayerState;
  currentEpisode: App.Episode | null;
  subscriptions: SubscriptionsMap;
  getEpisodes: (feed: string) => void;
  playEpisode: (episode: App.Episode) => void;
  resumeEpisode: () => void;
  pauseEpisode: () => void;
  addSubscription: (feed: string, podcasts: App.RenderablePodcast) => void;
  removeSubscription: (feed: string) => void;
}

class Episodes extends Component<EpisodesProps, any> {
  loadIfNeeded = () => {
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

  componentDidMount() {
    this.loadIfNeeded();
    scrollToTop();
  }

  componentDidUpdate() {
    this.loadIfNeeded();
  }

  renderLoading() {
    return <Loading />
  }

  renderEpisode = (episode: App.Episode) => {
    const {
      currentEpisode,
      playEpisode,
      pauseEpisode,
      resumeEpisode,
      state,
      theme,
    } = this.props;

    return (
      <Episode
        episode={episode}
        pause={pauseEpisode}
        play={playEpisode}
        resume={resumeEpisode}
        state={state}
        theme={theme}
        currentEpisode={currentEpisode}
      />
    );
  }

  renderLoaded(feed: string, info: App.EpisodeListing | null) {
    if (!info) {
      return (
        <div>
          Couldn't get Podcasts episodes
        </div>
      );
    }

    const {
      addSubscription,
      removeSubscription,
      subscriptions,
      theme,
    } = this.props;

    const isSubscribed = !!subscriptions[feed];

    const {
      author,
      cover,
      description,
      episodes,
      link,
      title,
    } = info;

    const handler = () => {
      isSubscribed ?
        removeSubscription(feed) :
        addSubscription(feed, {...info, feed})
    };

    return (
      <div class={`${normalizeEl} ${episodesContainer(theme)}`}>
        <div class={podcastInfo}>
          <div
            class={infoCover(cover)}
            role="img"
            aria-label={`${title} by ${author}`}
          />
          <div class={podcastInfoTitles(theme)}>
            <h1 class={podcastTitle}>{title}</h1>
            <h2 class={infoMargins}>{author} - <a href={link}>{stripHost(link)}</a></h2>
            <div class={infoMargins}>
              <button
                class={subscribeButton(theme)}
                data-is-subscribed={isSubscribed}
                onClick={handler}
              >
                {isSubscribed ? 'Unsubscribe' : 'Subscribe'}
              </button>
            </div>
            <p class={infoMargins} dangerouslySetInnerHTML={{ __html: description.trim() }} />
          </div>
        </div>
        <div class={episodesView}>
          {episodes.map(this.renderEpisode)}
        </div>
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

    return this.renderLoaded(feed, feedInfo.episodes);
  }
}

export default Episodes;
