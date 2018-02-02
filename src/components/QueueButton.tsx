/**
 * Queue play button
 */

import { h } from 'preact';

import Icon from '../svg/Icon';

interface IQueueButtonProps {
  episode: App.IEpisodeInfo;
  theme: App.ITheme;
  add: (episode: App.IEpisodeInfo) => void;
}

const QueueButton = ({ episode, theme, add }: IQueueButtonProps) => (
  <div onClick={() => add(episode)}>
    <Icon icon={'info'} color={theme.accent} />
  </div>
);

export default QueueButton;
