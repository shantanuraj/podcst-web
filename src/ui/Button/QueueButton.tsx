import * as React from 'react';
import { useAccountPlayback } from '@/shared/player/useAccountPlayback';
import { getEnqueueEpisode, usePlayer } from '@/shared/player/usePlayer';
import { getShowToast, useToast } from '@/shared/toast/useToast';
import type { IEpisodeInfo } from '@/types';
import { Icon } from '@/ui/icons/svg/Icon';
import styles from './QueueButton.module.css';

export interface QueueButtonProps extends React.ComponentProps<'button'> {
  episode: IEpisodeInfo;
}

export const QueueButton = React.memo(
  React.forwardRef<HTMLButtonElement, QueueButtonProps>(function QueueButton(
    { className, episode, ...props },
    ref,
  ) {
    const withAccount = useAccountPlayback();
    const showToast = useToast(getShowToast);
    const classes = className
      ? [className, styles.queue].join(' ')
      : styles.queue;
    const enqueueEpisode = usePlayer(getEnqueueEpisode);
    const handleClick = React.useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        withAccount(episode, () => {
          enqueueEpisode(episode, false);
          showToast(
            <span>
              <strong>{episode.title}</strong> added to queue
            </span>,
          );
        });
      },
      [showToast, enqueueEpisode, episode, withAccount],
    );
    return (
      <button {...props} className={classes} onClick={handleClick} ref={ref}>
        <Icon icon="queue" size={24} />
      </button>
    );
  }),
);

QueueButton.displayName = 'QueueButton';
