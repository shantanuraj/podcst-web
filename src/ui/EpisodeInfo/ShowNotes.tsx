import React from 'react';
import { linkifyText } from '../../shared/link/linkify-text';
import { getSecondsFromTimestamp } from '../../shared/player/formatTime';
import { getSeekOrStartAt, usePlayer } from '../../shared/player/usePlayer';
import { IEpisodeInfo } from '../../types';

import styles from './EpisodeInfo.module.css';

interface IShowNotesProps {
  className?: string;
  episode: IEpisodeInfo;
}

export const ShowNotes = ({ className = '', episode }: IShowNotesProps) => {
  const seekTo = usePlayer(getSeekOrStartAt);
  const handleTimestampClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isTimeStampButton(e.target)) {
        const timestamp = e.target.dataset.timestamp;
        if (!timestamp) return;
        seekTo(episode, getSecondsFromTimestamp(timestamp));
      }
    },
    [episode, seekTo],
  );
  return (
    <div className={`${styles.showNotes} ${className}`} onClick={handleTimestampClick}>
      <h3>Show Notes</h3>
      <div dangerouslySetInnerHTML={{ __html: linkifyText(episode.showNotes) }} />
    </div>
  );
};

function isTimeStampButton(target: EventTarget): target is HTMLButtonElement {
  return (target as HTMLElement)?.matches('button[data-timestamp]');
}
