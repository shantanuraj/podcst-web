/**
 * Player Info bar
 */

import { h } from 'preact';

import { Link } from 'preact-router';

import { media, style } from 'typestyle';

import Icon from '../svg/Icon';

import SeekButton from './SeekButton';

import { SeekDirection } from '../stores/player';

import { getEpisodeRoute, getEpisodesRoute, imageWithPlaceholder } from '../utils';

import { DESKTOP_PLAYER_HEIGHT, MOBILE_PLAYER_HEIGHT } from '../utils/constants';

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
  style(
    {
      backgroundImage: imageWithPlaceholder(mode, image),
      backgroundRepeat: 'no-repeat',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      height: 'inherit',
      width: DESKTOP_PLAYER_HEIGHT,
    },
    media(
      { maxWidth: 600 },
      {
        width: MOBILE_PLAYER_HEIGHT,
      },
    ),
  );

const episodeInfoContainer = style({
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  paddingRight: 16,
});

const episodeInfo = (theme: App.ITheme) =>
  style(
    {
      textOverflow: 'ellipsis',
      overflow: 'hidden',
      $nest: {
        '& [data-title]': {
          fontSize: 16,
        },
        '& [data-author]': {
          color: theme.subTitle,
          marginTop: 16,
          fontSize: 15,
          fontWeight: 'lighter',
        },
      },
    },
    media(
      { maxWidth: 600 },
      {
        $nest: {
          '& [data-author]': {
            marginTop: 8,
          },
        },
      },
    ),
  );

const buttonsContainer = style({
  height: '100%',
  display: 'flex',
  padding: '0 16px',
});

export const playerButton = (sizeRatio: number) =>
  style(
    {
      height: '100%',
      width: Math.round(DESKTOP_PLAYER_HEIGHT * sizeRatio),
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
        width: Math.round(MOBILE_PLAYER_HEIGHT * sizeRatio),
      },
    ),
  );

interface IPlayerInfoProps {
  episode: App.IEpisodeInfo;
  mode: App.ThemeMode;
  state: EpisodePlayerState;
  theme: App.ITheme;
  jumpSeek: (direction: SeekDirection) => void;
  pause();
  resume();
}

const MAIN_ICON_RATIO = 2 / 3;
const SUB_ICON_RATIO = MAIN_ICON_RATIO * MAIN_ICON_RATIO;

const PlayerInfo = ({
  episode: { author, cover, feed, episodeArt, title },
  mode,
  jumpSeek,
  pause,
  resume,
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
        onClick={() => jumpSeek('seek-back')}
        sizeRatio={SUB_ICON_RATIO}
        theme={theme}
      />
      <button
        role="button"
        aria-label={state === 'playing' ? 'Pause' : 'Play'}
        class={playerButton(MAIN_ICON_RATIO)}
        onClick={state === 'playing' ? pause : resume}
      >
        <Icon color={theme.accent} icon={state === 'playing' ? 'pause' : 'play'} size="100%" />
      </button>
      <SeekButton
        direction="seek-forward"
        label="Seek Forward 10 seconds"
        onClick={() => jumpSeek('seek-forward')}
        sizeRatio={SUB_ICON_RATIO}
        theme={theme}
      />
    </div>
    <Link class={linkContainer} href={getEpisodeRoute(feed, title)}>
      <div class={episodeInfoContainer}>
        <div class={episodeInfo(theme)}>
          <p data-title="true">{title}</p>
          <p data-author="true">{author}</p>
        </div>
      </div>
    </Link>
  </div>
);

export default PlayerInfo;
