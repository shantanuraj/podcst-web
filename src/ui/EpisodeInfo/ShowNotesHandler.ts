'use client';

import React from 'react';
import { getSecondsFromTimestamp } from '../../shared/player/formatTime';
import { getSeekOrStartAt, usePlayer } from '../../shared/player/usePlayer';
import { IEpisodeInfo } from '../../types';

interface ShowNotesHandlerProps {
  id: string;
  episode: IEpisodeInfo;
}

export const ShowNotesHandler = ({ id, episode }: ShowNotesHandlerProps) => {
  const seekTo = usePlayer(getSeekOrStartAt);
  const handleTimestampClick = React.useCallback(
    (e: MouseEvent) => {
      if (!(e.target instanceof HTMLElement)) return;
      if (isTimeStampButton(e.target)) {
        const timestamp = e.target.dataset.timestamp;
        if (!timestamp) return;
        seekTo(episode, getSecondsFromTimestamp(timestamp));
      }
    },
    [episode, seekTo],
  );

  React.useEffect(() => {
    const showNotes = document.getElementById(id) as HTMLDivElement | null;
    if (!showNotes) return;

    showNotes.addEventListener('click', handleTimestampClick);
    return () => showNotes.removeEventListener('click', handleTimestampClick);
  }, [id, handleTimestampClick]);

  return null;
};

function isTimeStampButton(target: EventTarget): target is HTMLButtonElement {
  return (target as HTMLElement)?.matches('button[data-timestamp]');
}
