import { useCallback } from 'react';
import { useTranslation } from '@/shared/i18n';
import { shortcuts } from '@/shared/keyboard/shortcuts';
import { useKeydown } from '@/shared/keyboard/useKeydown';
import type { IEpisodeInfo } from '@/types';
import { sameEpisode } from './episode-identity';
import { formatSecondsToTimestamp } from './formatTime';
import styles from './Player.module.css';
import { useAccountPlayback } from './useAccountPlayback';
import { useChapters } from './useChapters';
import {
  getCurrentEpisode,
  getPlaybackState,
  getSeekOrStartAt,
  getSeekPosition,
  usePlayer,
} from './usePlayer';

export const Seekbar = ({
  currentEpisode,
}: {
  currentEpisode: IEpisodeInfo;
}) => {
  const { t } = useTranslation();
  const state = usePlayer(getPlaybackState);
  const position = usePlayer(getSeekPosition);
  const measuredDuration = usePlayer((state) => state.duration);
  const duration =
    (state === 'buffering' ? currentEpisode.duration : measuredDuration) || 0;
  const seekTo = usePlayer(getSeekOrStartAt);
  const withAccount = useAccountPlayback();
  const { chapters } = useChapters(currentEpisode);
  const seek = useCallback(
    (seconds: number) =>
      withAccount(currentEpisode, () => {
        if (
          sameEpisode(getCurrentEpisode(usePlayer.getState()), currentEpisode)
        )
          seekTo(currentEpisode, seconds);
      }),
    [currentEpisode, seekTo, withAccount],
  );
  const seekOnKeydown = useCallback(
    (event: KeyboardEvent) => {
      const fraction = Number.parseInt(event.key, 10) / 10;
      if (duration && Number.isFinite(fraction))
        seek(Math.floor(fraction * duration));
    },
    [duration, seek],
  );
  useKeydown(shortcuts.seekTo, seekOnKeydown);
  const value = Math.max(0, Math.min(position, duration));

  return (
    <div className={styles.seekbar}>
      <div
        className={styles.progress}
        data-buffering={state === 'buffering'}
        style={{
          width:
            state === 'buffering'
              ? '100%'
              : duration
                ? `${(value / duration) * 100}%`
                : '0%',
        }}
      />
      {duration > 0 &&
        chapters
          .filter(({ start }) => start > 0 && start < duration)
          .map(({ start }) => (
            <span
              key={start}
              className={styles.chapterMarker}
              aria-hidden="true"
              style={{ left: `${(start / duration) * 100}%` }}
            />
          ))}
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.1}
        value={value}
        disabled={!duration}
        aria-label={t('chapters.position')}
        aria-valuetext={formatSecondsToTimestamp(value)}
        onChange={(event) => seek(event.currentTarget.valueAsNumber)}
      />
    </div>
  );
};
