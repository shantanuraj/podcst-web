/**
 * Episode play button
 */

import { h } from 'preact';

import { style } from 'typestyle';

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
      '&:hover, &:focus, &:active, &[data-is-playing], &[data-is-paused]': {
        outline: 0,
        backgroundColor: theme.accent,
        color: theme.background,
      },
    },
  });

interface IPlayButtonProps {
  currentEpisode: App.IEpisodeInfo | null;
  episode: App.IEpisodeInfo;
  state: EpisodePlayerState;
  theme: App.ITheme;
  play();
  pause();
  resume();
}

const PlayButton = ({ currentEpisode, episode, play, pause, resume, state, theme }: IPlayButtonProps) => {
  const isCurrent = currentEpisode === episode;
  const isPlaying = isCurrent && state === 'playing';
  const isPaused = isCurrent && state === 'paused';

  const handler = isPlaying ? pause : isPaused ? resume : play;
  const text = isPlaying ? 'Pause' : isPaused ? 'Resume' : 'Play';

  return (
    <button class={playButton(theme)} data-is-playing={isPlaying} data-is-paused={isPaused} onClick={handler}>
      {text}
    </button>
  );
};

export default PlayButton;
