/**
 * Episode play button
 */

import * as React from 'react';

import { style } from 'typestyle';

import { App, EpisodePlayerState } from '../typings';

const playButton = (theme: App.ITheme) =>
  style({
    display: 'inline-block',
    minWidth: '80px',
    borderRadius: '3px',
    padding: '8px',
    background: 'transparent',
    color: theme.text,
    border: `2px solid ${theme.accent}`,
    $nest: {
      '&:hover, &:focus, &:active, &[data-is-playing="true"], &[data-is-paused="true"]': {
        outline: 0,
        backgroundColor: theme.accent,
        color: theme.background,
      },
    },
  });

export interface IPlayButtonProps {
  isCurrentEpisode: boolean;
  state: EpisodePlayerState;
  theme: App.ITheme;
  play();
  pause();
  resume();
}

const PlayButton = ({ isCurrentEpisode, play, pause, resume, state, theme }: IPlayButtonProps) => {
  const isPlaying = isCurrentEpisode && state === 'playing';
  const isPaused = isCurrentEpisode && state === 'paused';

  const handler = isPlaying ? pause : isPaused ? resume : play;
  const text = isPlaying ? 'Pause' : isPaused ? 'Resume' : 'Play';

  return (
    <button className={playButton(theme)} data-is-playing={isPlaying} data-is-paused={isPaused} onClick={handler}>
      {text}
    </button>
  );
};

export default PlayButton;
