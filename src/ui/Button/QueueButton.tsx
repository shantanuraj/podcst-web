import * as React from 'react';
import { getQueueEpisode, usePlayer } from '../../shared/player/usePlayer';
import { getShowToast, useToast } from '../../shared/toast/useToast';
import { IEpisodeInfo } from '../../types';
import { Icon } from '../icons/svg/Icon';
import styles from './QueueButton.module.css';

export interface QueueButtonProps extends React.ComponentProps<'button'> {
  episode: IEpisodeInfo;
}

export const QueueButton = React.memo(
  React.forwardRef<HTMLButtonElement, QueueButtonProps>(function QueueButton(
    { className, episode, ...props },
    ref,
  ) {
    const showToast = useToast(getShowToast);
    const classes = className ? [className, styles.queue].join(' ') : styles.queue;
    const queueEpisode = usePlayer(getQueueEpisode);
    const handleClick = React.useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        queueEpisode(episode);
        showToast(
          <span>
            <strong>{episode.title}</strong> added to queue
          </span>,
        );
      },
      [showToast, queueEpisode, episode],
    );
    return (
      <button {...props} className={classes} onClick={handleClick} ref={ref}>
        <Icon icon="queue" size={24} />
      </button>
    );
  }),
);
