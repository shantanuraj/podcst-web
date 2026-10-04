'use client';

import React from 'react';
import { getSecondsFromTimestamp } from '@/shared/player/formatTime';
import { useAccountPlayback } from '@/shared/player/useAccountPlayback';
import { getSeekOrStartAt, usePlayer } from '@/shared/player/usePlayer';
import type { IEpisodeInfo } from '@/types';

interface ShowNotesHandlerProps {
  id: string;
  episode: IEpisodeInfo;
}

export const ShowNotesHandler = ({ id, episode }: ShowNotesHandlerProps) => {
  const withAccount = useAccountPlayback();
  const seekTo = usePlayer(getSeekOrStartAt);
  const handleTimestampClick = React.useCallback(
    (e: MouseEvent) => {
      if (!(e.target instanceof HTMLElement)) return;
      if (isTimeStampButton(e.target)) {
        const timestamp = e.target.dataset.timestamp;
        if (!timestamp) return;
        const seconds = getSecondsFromTimestamp(timestamp);
        if (seconds === null) return;
        withAccount(episode, () => seekTo(episode, seconds));
      }
    },
    [episode, seekTo, withAccount],
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
