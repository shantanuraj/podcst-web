'use client';

import { useTranslation } from '@/shared/i18n';
import type { IEpisodeInfo } from '@/types';
import { Icon } from '@/ui/icons/svg/Icon';
import { skip } from '../../../contracts/playback/rules.json';
import { navigateChapter } from './chapter-playback';
import styles from './Transport.module.css';
import { useAccountPlayback } from './useAccountPlayback';
import { useChapters } from './useChapters';
import { getPlaybackState, usePlayer } from './usePlayer';

function SkipIcon({ direction }: { direction: 'back' | 'forward' }) {
  const back = direction === 'back';
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path
        d={
          back
            ? 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4h4'
            : 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4h-4'
        }
      />
      <text
        x={back ? 12.5 : 11.5}
        y="15"
        fontSize="7"
        fontWeight="600"
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
      >
        {back ? skip.backwardSeconds : skip.forwardSeconds}
      </text>
    </svg>
  );
}

function ChapterIcon({ direction }: { direction: 'previous' | 'next' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        d={
          direction === 'previous'
            ? 'M6 6v12M18 6l-9 6 9 6z'
            : 'M18 6v12M6 6l9 6-9 6z'
        }
      />
    </svg>
  );
}

export function PlayPause() {
  const { t } = useTranslation();
  const state = usePlayer(getPlaybackState);
  const playing = state === 'playing' || state === 'buffering';
  return (
    <button
      type="button"
      className={styles.play}
      onClick={usePlayer.getState().togglePlayback}
      aria-label={playing ? t('player.pause') : t('player.play')}
    >
      <Icon icon={playing ? 'pause' : 'play'} size={24} />
    </button>
  );
}

export function Transport({
  episode,
  size,
}: {
  episode: IEpisodeInfo;
  size: 'bar' | 'stage';
}) {
  const { t } = useTranslation();
  const withAccount = useAccountPlayback();
  const { chapters } = useChapters(episode);
  const { seekBackward, seekForward } = usePlayer.getState();
  const chapter = (direction: 'previous' | 'next') =>
    withAccount(episode, () =>
      navigateChapter(usePlayer.getState(), episode, chapters, direction),
    );
  return (
    <div className={styles.transport} data-size={size}>
      <button
        type="button"
        onClick={() => chapter('previous')}
        aria-label={t('chapters.previous')}
      >
        <ChapterIcon direction="previous" />
      </button>
      <button
        type="button"
        className={styles.skip}
        onClick={seekBackward}
        aria-label={t('player.skipBack', { seconds: skip.backwardSeconds })}
      >
        <SkipIcon direction="back" />
      </button>
      <PlayPause />
      <button
        type="button"
        className={styles.skip}
        onClick={seekForward}
        aria-label={t('player.skipForward', { seconds: skip.forwardSeconds })}
      >
        <SkipIcon direction="forward" />
      </button>
      <button
        type="button"
        onClick={() => chapter('next')}
        aria-label={t('chapters.next')}
      >
        <ChapterIcon direction="next" />
      </button>
    </div>
  );
}
