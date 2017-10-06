/**
 * Player Info bar
 */

import {
  h,
} from 'preact';

import {
  Link,
} from 'preact-router';

import {
  media,
  style,
} from 'typestyle';

import Icon from '../svg/Icon';

import {
  IEpisodeInfo,
} from '../stores/player';

import {
  getEpisodeRoute,
} from '../utils';

const infoContainer = (theme: App.Theme) => style(
  {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    backgroundColor: theme.background,
  },
  media({ maxWidth: 600 }, {
    boxShadow: `0px 4px 32px 4px rgba(0,0,0,0.75)`,
  }),
);

const linkContainer = style({
  height: '100%',
  display: 'flex',
});

const episodeImage = (image: string) => style({
  backgroundImage: `url(${image})`,
  backgroundRepeat: 'no-repeat',
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  height: 'inherit',
  width: '64px',
});

const episodeInfo = style({
  display: 'flex',
  height: '100%',
  flexDirection: 'column',
  justifyContent: 'space-evenly' as any,
  paddingLeft: 16,
  paddingRight: 16,
  $nest: {
    '&>*': {
      fontSize: '14px',
      fontWeight: 'bold',
    },
    '&>*:last-child': {
      fontSize: '10px',
      fontWeight: 'lighter',
    },
  },
});

const playButton = style({
  height: '100%',
  width: '64px',
  background: 'inherit',
  border: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  outline: 0,
});

interface IPlayerInfoProps {
  episode: IEpisodeInfo;
  state: EpisodePlayerState;
  theme: App.Theme;
  pause();
  resume();
}

const PlayerInfo = ({
  episode: {
    author,
    cover,
    feed,
    episodeArt,
    title,
  },
  pause,
  resume,
  state,
  theme,
}: IPlayerInfoProps) => (
  <div class={infoContainer(theme)}>
    <button
      aria-label={state === 'playing' ? 'Pause' : 'Play'}
      class={playButton}
      onClick={state === 'playing' ? pause : resume }>
      <Icon
        color={theme.accent}
        icon={state === 'playing' ? 'pause' : 'play'}
      />
    </button>
    <Link
      class={linkContainer}
      href={getEpisodeRoute(feed, title)}
    >
      <div
        class={episodeImage(episodeArt || cover as string)}
        role="img"
        aria-label={`${title} episode art`}
      />
      <div class={episodeInfo}>
        <p>
          {title}
        </p>
        <p>
          {author}
        </p>
      </div>
    </Link>
  </div>
);

export default PlayerInfo;
