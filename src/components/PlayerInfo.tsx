/**
 * Player Info bar
 */

import { h } from 'preact';

import { Link } from 'preact-router';

import { media, style } from 'typestyle';

import Icon from '../svg/Icon';

import SeekButton from './SeekButton';

import { getEpisodeRoute, getEpisodesRoute, imageWithPlaceholder } from '../utils';

import { DESKTOP_PLAYER_HEIGHT } from '../utils/constants';

const infoContainer = (theme: App.ITheme) =>
  style(
    {
      height: '100%',
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      backgroundColor: theme.background,
    },
    media(
      { maxWidth: 600 },
      {
        boxShadow: `0px 4px 32px 4px rgba(0,0,0,0.75)`,
      },
    ),
  );

const linkContainer = style({
  height: '100%',
  display: 'flex',
});

const episodeImage = (mode: App.ThemeMode, image: string) =>
  style({
    backgroundImage: imageWithPlaceholder(mode, image),
    backgroundRepeat: 'no-repeat',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    height: 'inherit',
    width: DESKTOP_PLAYER_HEIGHT,
  });

const episodeInfo = style({
  display: 'flex',
  height: '100%',
  flexDirection: 'column',
  justifyContent: 'space-around',
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

const buttonsContainer = style(
  {
    height: '100%',
    display: 'flex',
    padding: '0 16px',
  },
  media(
    { maxWidth: 600 },
    {
      padding: '0 16px',
    },
  ),
);

export const playerButton = (width: number) =>
  style(
    {
      height: '100%',
      width,
      background: 'inherit',
      border: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      outline: 0,
      padding: 0,
    },
    media(
      { maxWidth: 600 },
      {
        $nest: {
          '&[data-hide-on-mobile]': {
            display: 'none',
          },
        },
      },
    ),
  );

interface IPlayerInfoProps {
  duration: number;
  episode: App.IEpisodeInfo;
  mode: App.ThemeMode;
  seekPosition: number;
  state: EpisodePlayerState;
  theme: App.ITheme;
  jumpSeek: (seekDirection: 'seek-forward' | 'seek-back', seekPosition: number, duration: number) => void;
  pause();
  resume();
}

const MAIN_ICON_SIZE = Math.round(DESKTOP_PLAYER_HEIGHT * 2 / 3);
const SUB_ICON_SIZE = Math.round(MAIN_ICON_SIZE * 2 / 3);

const PlayerInfo = ({
  duration,
  episode: { author, cover, feed, episodeArt, title },
  mode,
  jumpSeek,
  pause,
  resume,
  seekPosition,
  state,
  theme,
}: IPlayerInfoProps) => (
  <div class={infoContainer(theme)}>
    <Link class={linkContainer} href={getEpisodesRoute(feed)}>
      <div class={episodeImage(mode, episodeArt || cover)} role="img" aria-label={`${title} episode art`} />
    </Link>
    <div class={buttonsContainer}>
      <SeekButton
        direction="seek-back"
        label="Seek Back 10 seconds"
        onClick={() => jumpSeek('seek-back', seekPosition, duration)}
        size={SUB_ICON_SIZE}
        theme={theme}
      />
      <button
        role="button"
        aria-label={state === 'playing' ? 'Pause' : 'Play'}
        class={playerButton(MAIN_ICON_SIZE)}
        onClick={state === 'playing' ? pause : resume}
      >
        <Icon color={theme.accent} icon={state === 'playing' ? 'pause' : 'play'} size={MAIN_ICON_SIZE} />
      </button>
      <SeekButton
        direction="seek-forward"
        label="Seek Forward 10 seconds"
        onClick={() => jumpSeek('seek-forward', seekPosition, duration)}
        size={SUB_ICON_SIZE}
        theme={theme}
      />
    </div>
    <Link class={linkContainer} href={getEpisodeRoute(feed, title)}>
      <div class={episodeInfo}>
        <p>{title}</p>
        <p>{author}</p>
      </div>
    </Link>
  </div>
);

export default PlayerInfo;
