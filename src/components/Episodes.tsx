import { h, Component } from 'preact';
import {
  style,
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

const darkBg = style({
  backgroundColor: '#292929',
  color: 'white',
});

const podcastInfo = style({
  display: 'flex',
  justifyContent: 'space-between',
});

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

const podcastTitle = style({
  fontSize: '40px',
  fontWeight: 'bold',
});

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
    return <Loading />
  }

  renderLoaded(info: App.EpisodeListing | null) {
    if (!info) {
      return (
        <div>
          Couldn't get Podcasts episodes
        </div>
      );
    }

    const {
      author,
      cover,
      description,
      link,
      title,
    } = info;

    const infoCover = style({
      backgroundImage: `url(${cover})`,
      backgroundRepeat: 'no-repeat',
      backgroundSize: 'cover',
      width: '300px',
      height: '300px',
      minWidth: '300px',
    });

    return (
      <div class={`${normalizeEl} ${darkBg}`}>
        <div class={podcastInfo}>
          <div
            class={infoCover}
            role="img"
            aria-label={`${title} by ${author}`}
          />
          <div class={podcastInfoTitles}>
            <h1 class={podcastTitle}>{title}</h1>
            <h2>{author} - <a href={link}>{stripHost(link)}</a></h2>
            <p
              dangerouslySetInnerHTML={{
                __html: description.trim()
              }}
            />
          </div>
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

    return this.renderLoaded(feedInfo.episodes);
  }
}

export default Episodes;
