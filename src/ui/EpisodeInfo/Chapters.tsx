'use client';

import { useId } from 'react';
import { currentChapterIndex } from '@/shared/chapters';
import { useTranslation } from '@/shared/i18n';
import { navigateChapter } from '@/shared/player/chapter-playback';
import { sameEpisode } from '@/shared/player/episode-identity';
import { formatSecondsToTimestamp } from '@/shared/player/formatTime';
import { useAccountPlayback } from '@/shared/player/useAccountPlayback';
import { useChapters } from '@/shared/player/useChapters';
import {
  getCurrentEpisode,
  getSeekOrStartAt,
  usePlayer,
} from '@/shared/player/usePlayer';
import type { IEpisodeInfo } from '@/types';
import styles from './Chapters.module.css';

export function Chapters({ episode }: { episode: IEpisodeInfo }) {
  const { t } = useTranslation();
  const heading = useId();
  const { chapters, source, loading } = useChapters(episode);
  const withAccount = useAccountPlayback();
  const seek = usePlayer(getSeekOrStartAt);
  const playing = usePlayer((state) =>
    sameEpisode(getCurrentEpisode(state), episode),
  );
  const current = usePlayer((state) =>
    sameEpisode(getCurrentEpisode(state), episode)
      ? currentChapterIndex(chapters, state.seekPosition)
      : -1,
  );
  const navigate = (direction: 'previous' | 'next') =>
    withAccount(episode, () =>
      navigateChapter(usePlayer.getState(), episode, chapters, direction),
    );

  return (
    <section aria-labelledby={heading} className={styles.chapters}>
      <h3 id={heading}>{t('chapters.title')}</h3>
      <p role="status" className={styles.status}>
        {loading
          ? t('chapters.loading')
          : source === 'shownotes'
            ? t('chapters.fallback')
            : chapters.length
              ? ''
              : t('chapters.unavailable')}
      </p>
      {playing && (
        <div className={styles.controls}>
          <button type="button" onClick={() => navigate('previous')}>
            {t('chapters.previous')}
          </button>
          <button type="button" onClick={() => navigate('next')}>
            {t('chapters.next')}
          </button>
        </div>
      )}
      <ol className={styles.list}>
        {chapters.map((chapter, index) => {
          const title =
            chapter.title || t('chapters.untitled', { number: index + 1 });
          const timestamp = formatSecondsToTimestamp(chapter.start);
          return (
            <li key={chapter.start}>
              <button
                type="button"
                aria-current={current === index ? 'true' : undefined}
                aria-label={t('chapters.seek', { title, timestamp })}
                onClick={() =>
                  withAccount(episode, () => seek(episode, chapter.start))
                }
              >
                <span className={styles.timestamp}>{timestamp}</span>
                <span>{title}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
