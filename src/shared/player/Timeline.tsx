'use client';

import { useTranslation } from '@/shared/i18n';
import type { IEpisodeInfo } from '@/types';
import { sameEpisode } from './episode-identity';
import { formatSecondsToTimestamp } from './formatTime';
import styles from './Timeline.module.css';
import { useAccountPlayback } from './useAccountPlayback';
import { getCurrentEpisode, usePlayer } from './usePlayer';
import { useTimeline } from './useTimeline';

export function Timeline({
  episode,
  size,
}: {
  episode: IEpisodeInfo;
  size: 'bar' | 'stage';
}) {
  const { t } = useTranslation();
  const { position, duration, segments } = useTimeline(episode);
  const buffering = usePlayer((state) => state.state === 'buffering');
  const withAccount = useAccountPlayback();
  const seek = (seconds: number) =>
    withAccount(episode, () => {
      const player = usePlayer.getState();
      if (sameEpisode(getCurrentEpisode(player), episode))
        player.seekOrStartAt(episode, seconds);
    });

  return (
    <div className={styles.timeline} data-size={size}>
      <span className={styles.time}>{formatSecondsToTimestamp(position)}</span>
      <div className={styles.track} data-buffering={buffering}>
        {segments.map(({ start, length, fill }) => (
          <span
            key={start}
            className={styles.segment}
            style={{ flexGrow: Math.max(length, 1) }}
          >
            <span style={{ width: `${fill * 100}%` }} />
          </span>
        ))}
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={1}
          value={position}
          disabled={!duration}
          aria-label={t('chapters.position')}
          aria-valuetext={formatSecondsToTimestamp(position)}
          onChange={(event) => seek(event.currentTarget.valueAsNumber)}
        />
      </div>
      <span className={styles.time}>
        −{formatSecondsToTimestamp(Math.max(duration - position, 0))}
      </span>
    </div>
  );
}
