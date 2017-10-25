/**
 * Player component
 */

import { h } from 'preact';

import { media, style } from 'typestyle';

import { IPlayerState, SeekDirection } from '../stores/player';

import { DESKTOP_PLAYER_HEIGHT, MOBILE_PLAYER_HEIGHT } from '../utils/constants';

import PlayerInfo from './PlayerInfo';

import ConnectedSeekView from '../containers/ConnectedSeekView';

const player = (theme: App.ITheme) =>
  style(
    {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-start',
      position: 'fixed',
      bottom: 0,
      left: 0,
      height: DESKTOP_PLAYER_HEIGHT,
      width: '100%',
      zIndex: 500,
      fontSize: 20,
      color: theme.text,
      boxShadow: `0px 4px 32px 4px rgba(0,0,0,0.75)`,
      transform: `translateY(${DESKTOP_PLAYER_HEIGHT}px)`,
      transition: 'all 0.3s ease',
      $nest: {
        '& [data-display-on-hover]': {
          opacity: 0,
        },
        '&:hover [data-display-on-hover]': {
          opacity: 1,
        },
        '&[data-is-player-visible]': {
          transform: `translateY(0px)`,
        },
      },
    },
    media(
      { maxWidth: 600 },
      {
        height: MOBILE_PLAYER_HEIGHT,
        transform: `translateY(${MOBILE_PLAYER_HEIGHT}px)`,
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
    <div data-is-player-visible={isVisible} class={player(theme)}>
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
  ) : (
    <div player-visible={isVisible} class={player(theme)} />
  );
};

export default Player;
