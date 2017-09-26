/**
 * Player Info bar
 */

import {
  h,
} from 'preact';

import {
  media,
  style,
} from 'typestyle';

import Icon from '../svg/Icon';

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

interface PlayerInfoProps {
  episode: App.Episode;
  state: EpisodePlayerState;
  theme: App.Theme;
  pause();
  resume();
}

const PlayerInfo = ({
  episode: {
    author,
    cover,
    episodeArt,
    title,
  },
  pause,
  resume,
  state,
  theme,
}: PlayerInfoProps) => (
  <div class={infoContainer(theme)}>
    <Icon
      theme={theme}
      onClick={state === 'playing' ? pause : resume }
      icon={state === 'playing' ? 'pause' : 'play'}
    />
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
  </div>
);

export default PlayerInfo;
