import React from 'react';
import { linkifyText } from '../../shared/link/linkify-text';
import { getSecondsFromTimestamp } from '../../shared/player/formatTime';
import { getSeekTo, usePlayer } from '../../shared/player/usePlayer';

import styles from './EpisodeInfo.module.css';

interface IShowNotesProps {
  className?: string;
  showNotes: string;
}

export const ShowNotes = ({ className = '', showNotes }: IShowNotesProps) => {
  const seekTo = usePlayer(getSeekTo);
  const handleTimestampClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isTimeStampButton(e.target)) {
        const timestamp = e.target.dataset.timestamp;
        if (!timestamp) return;
        seekTo(getSecondsFromTimestamp(timestamp));
      }
    },
    [seekTo],
  );
  return (
    <div className={`${styles.showNotes} ${className}`} onClick={handleTimestampClick}>
      <h3>Show Notes</h3>
      <div dangerouslySetInnerHTML={{ __html: linkifyText(showNotes) }} />
    </div>
  );
};

function isTimeStampButton(target: EventTarget): target is HTMLButtonElement {
  return (target as HTMLElement)?.matches('button[data-timestamp]');
}
