/**
 * Player component
 */

import { h } from 'preact';

import { media, style } from 'typestyle';

import { IPlayerState } from '../stores/player';

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
  pause: () => void;
  resume: () => void;
  skipToNext: () => void;
  skipToPrev: () => void;
  onSeek: (seekPosition: number, duration: number) => void;
  jumpSeek: (seekDirection: 'seek-forward' | 'seek-back', seekPosition: number, duration: number) => void;
}

const Player = ({
  duration,
  currentEpisode,
  jumpSeek,
  mode,
  pause,
  queue,
  resume,
  seekPosition,
  state,
  theme,
}: IPlayerProps) => {
  const episode = queue[currentEpisode];

  if (state === 'stopped' || !episode) {
    return null;
  }

  const episodeDuration = duration || episode.duration || 0;

  /* tslint:disable:no-console */
  console.log(episodeDuration, duration, episode.duration);

  return (
    <div class={player(theme)}>
      <PlayerInfo
        duration={episodeDuration}
        episode={episode}
        jumpSeek={jumpSeek}
        mode={mode}
        pause={pause}
        resume={resume}
        seekPosition={seekPosition}
        state={state}
        theme={theme}
      />
      <ConnectedSeekView />
    </div>
  );
};

export default Player;
