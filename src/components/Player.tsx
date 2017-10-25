/**
 * Player component
 */

import { h } from 'preact';

import { media, style } from 'typestyle';

import { IPlayerState, SeekDirection } from '../stores/player';

import { DESKTOP_PLAYER_HEIGHT, MOBILE_PLAYER_HEIGHT } from '../utils/constants';

import PlayerInfo from './PlayerInfo';

import LargeSeekbar from './LargeSeekbar';

import ConnectedSeekView from '../containers/ConnectedSeekView';

const playerContainer = style(
  {
    display: 'flex',
    flexDirection: 'column',
    position: 'fixed',
    bottom: 0,
    left: 0,
    height: DESKTOP_PLAYER_HEIGHT * 2,
    width: '100%',
    zIndex: 500,
    boxShadow: `0px 4px 32px 4px rgba(0,0,0,0.75)`,
    transform: `translateY(${DESKTOP_PLAYER_HEIGHT * 2}px)`,
    transition: 'all 0.3s ease',
    $nest: {
      '&[data-is-player-visible]': {
        transform: `translateY(${DESKTOP_PLAYER_HEIGHT}px)`,
      },
    },
  },
  media(
    { maxWidth: 600 },
    {
      height: MOBILE_PLAYER_HEIGHT * 2,
      transform: `translateY(${MOBILE_PLAYER_HEIGHT * 2}px)`,
      $nest: {
        '&[data-is-player-visible]': {
          transform: `translateY(${MOBILE_PLAYER_HEIGHT}px)`,
        },
        '&[data-is-seek-visible]': {
          transform: `translateY(0px)`,
        },
      },
    },
  ),
);

const player = (theme: App.ITheme) =>
  style(
    {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-start',
      height: DESKTOP_PLAYER_HEIGHT,
      width: '100%',
      fontSize: 20,
      color: theme.text,
      $nest: {
        '& [data-display-on-hover]': {
          opacity: 0,
        },
        '&:hover [data-display-on-hover]': {
          opacity: 1,
        },
      },
    },
    media(
      { maxWidth: 600 },
      {
        height: MOBILE_PLAYER_HEIGHT,
      },
    ),
  );

interface IPlayerProps extends IPlayerState {
  mode: App.ThemeMode;
  theme: App.ITheme;
  duration: never;
  seekPosition: never;
  jumpSeek: (seekDirection: SeekDirection) => void;
  onSeek: (seekPosition: number, duration: number) => void;
  pause: () => void;
  resume: () => void;
  skipToNext: () => void;
  skipToPrev: () => void;
  showModal: () => void;
}

const Player = ({ currentEpisode, jumpSeek, mode, pause, queue, resume, showModal, state, theme }: IPlayerProps) => {
  const episode = queue[currentEpisode];

  const isVisible = state !== 'stopped' && !!episode;

  return isVisible ? (
    <div data-is-seek-visible={isVisible} data-is-player-visible={isVisible} class={playerContainer}>
      <div class={player(theme)}>
        <PlayerInfo
          episode={episode}
          jumpSeek={jumpSeek}
          mode={mode}
          pause={pause}
          resume={resume}
          showModal={showModal}
          state={state}
          theme={theme}
        />
        <ConnectedSeekView />
      </div>
      <LargeSeekbar
        mode="inline"
        buffering={true}
        duration={180}
        seekPosition={90}
        onSeek={(_x, _y) => ({})}
        theme={theme}
      />
    </div>
  ) : (
    <div player-visible={isVisible} class={player(theme)} />
  );
};

export default Player;
