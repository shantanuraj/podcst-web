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
  stripHost,
} from '../utils';

import {
  normalizeEl,
} from '../utils/styles';

import Loading from './Loading';
import Episode from './Episode';

const darkBg = style({
  backgroundColor: '#292929',
  color: 'white',
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

const podcastInfoTitles = style({
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  padding: 16,
  paddingTop: 8,
  $nest: {
    '& a': {
      color: '#82ffb5',
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

const subscribeButton = style({
  display: 'inline-block',
  minWidth: '80px',
  borderRadius: '3px',
  padding: '8px',
  background: 'transparent',
  color: 'white',
  border: '2px solid #82ffb5',
  $nest: {
    '&:hover': {
      outline: 0,
      backgroundColor: '#82ffb5',
      color: '#292929',
    },
  },
});

const episodesView = style({
  paddingTop: 32,
  paddingBottom: 32,
});

interface EpisodesProps {
  feed: string;
  info: PodcastsState;
  state: EpisodePlayerState;
  currentEpisode: App.Episode | null;
  getEpisodes: (feed: string) => void;
  playEpisode: (episode: App.Episode) => void;
  resumeEpisode: () => void;
  pauseEpisode: () => void;
  addSubscription: (feed: string, podcasts: App.RenderablePodcast) => void;
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
    } = this.props;

    return (
      <Episode
        episode={episode}
        pause={pauseEpisode}
        play={playEpisode}
        resume={resumeEpisode}
        state={state}
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
    } = this.props;

    const {
      author,
      cover,
      description,
      episodes,
      link,
      title,
    } = info;

    const subscribe = () => addSubscription(feed, {...info, feed});

    return (
      <div class={`${normalizeEl} ${darkBg}`}>
        <div class={podcastInfo}>
          <div
            class={infoCover(cover)}
            role="img"
            aria-label={`${title} by ${author}`}
          />
          <div class={podcastInfoTitles}>
            <h1 class={podcastTitle}>{title}</h1>
            <h2 class={infoMargins}>{author} - <a href={link}>{stripHost(link)}</a></h2>
            <div class={infoMargins}>
              <button onClick={subscribe} class={subscribeButton}>Subscribe</button>
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
