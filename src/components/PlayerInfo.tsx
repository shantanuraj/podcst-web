/**
 * Player Info bar
 */

import { h } from 'preact';

import { Link } from 'preact-router';

import { media, style } from 'typestyle';

import Icon from '../svg/Icon';

import { getEpisodeRoute, imageWithPlaceholder } from '../utils';

import { DESKTOP_PLAYER_HEIGHT } from '../utils/constants';

const infoContainer = (theme: App.ITheme) =>
  style(
    {
      height: '100%',
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

const episodeInfo = style(
  {
    display: 'flex',
    height: '100%',
    flexDirection: 'column',
    justifyContent: 'space-around',
    marginRight: 16,
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
  },
  media(
    { maxWidth: 600 },
    {
      marginRight: 0,
    },
  ),
);

const buttonsContainer = style({
  height: '100%',
  display: 'flex',
  padding: '0 32px',
});

const playerButton = (width: number) =>
  style({
    height: '100%', // width,
    width,
    background: 'inherit',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    outline: 0,
    padding: 0,
  });

interface IPlayerInfoProps {
  episode: App.IEpisodeInfo;
  mode: App.ThemeMode;
  state: EpisodePlayerState;
  theme: App.ITheme;
  pause();
  resume();
}

const MAIN_ICON_SIZE = Math.round(DESKTOP_PLAYER_HEIGHT * 2 / 3);
const SUB_ICON_SIZE = Math.round(MAIN_ICON_SIZE * 2 / 3);

const PlayerInfo = ({
  episode: { author, cover, feed, episodeArt, title },
  mode,
  pause,
  resume,
  state,
  theme,
}: IPlayerInfoProps) => (
  <div class={infoContainer(theme)}>
    <Link class={linkContainer} href={getEpisodeRoute(feed, title)}>
      <div class={episodeImage(mode, episodeArt || cover)} role="img" aria-label={`${title} episode art`} />
    </Link>
    <div class={buttonsContainer}>
      <button role="button" aria-label="Seek Back 10 seconds" class={playerButton(SUB_ICON_SIZE)}>
        <Icon color={theme.accent} icon="seek-back-10" size={SUB_ICON_SIZE} />
      </button>
      <button
        role="button"
        aria-label={state === 'playing' ? 'Pause' : 'Play'}
        class={playerButton(MAIN_ICON_SIZE)}
        onClick={state === 'playing' ? pause : resume}
      >
        <Icon color={theme.accent} icon={state === 'playing' ? 'pause' : 'play'} size={MAIN_ICON_SIZE} />
      </button>
      <button role="button" aria-label="Seek forward 10 seconds" class={playerButton(SUB_ICON_SIZE)}>
        <Icon color={theme.accent} icon="seek-forward-10" size={SUB_ICON_SIZE} />
      </button>
    </div>
    <div class={linkContainer}>
      <div class={episodeInfo}>
        <p>{title}</p>
        <p>{author}</p>
      </div>
    </div>
  </div>
);

export default PlayerInfo;
