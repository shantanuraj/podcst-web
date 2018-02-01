/**
 * Queue play button
 */

import { h } from 'preact';

import { style } from 'typestyle';

const queueButton = (theme: App.ITheme) =>
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

interface IQueueButtonProps {
  episode: App.IEpisodeInfo;
  theme: App.ITheme;
  add(episode: App.IEpisodeInfo);
}

const QueueButton = ({ episode, theme, add }: IQueueButtonProps) => {
  return (
    <button class={queueButton(theme)} onClick={add(episode)}>
      Add
    </button>
  );
};

export default QueueButton;
