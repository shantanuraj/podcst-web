/**
 * Queue play button
 */

import { h } from 'preact';

import Icon from '../svg/Icon';

import { MAIN_ICON_RATIO } from '../utils/constants';

import { playerButton } from '../components/PlayerInfo';

interface IQueueButtonProps {
  episode: App.IEpisodeInfo;
  theme: App.ITheme;
  add: (episode: App.IEpisodeInfo) => void;
}

const QueueButton = ({ episode, theme, add }: IQueueButtonProps) => (
  <div class={playerButton(MAIN_ICON_RATIO)} onClick={() => add(episode)}>
    <Icon icon={'queue'} color={theme.accent} size={'100%'} />
  </div>
);

export default QueueButton;
