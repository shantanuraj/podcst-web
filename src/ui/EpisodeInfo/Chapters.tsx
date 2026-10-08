'use client';

import { useId } from 'react';
import { chapterEnd, currentChapterIndex } from '@/shared/chapters';
import { useTranslation } from '@/shared/i18n';
import { sameEpisode } from '@/shared/player/episode-identity';
import {
  formatDuration,
  formatSecondsToTimestamp,
} from '@/shared/player/formatTime';
import { useAccountPlayback } from '@/shared/player/useAccountPlayback';
import { useChapters } from '@/shared/player/useChapters';
import {
  getCurrentEpisode,
  getSeekOrStartAt,
  usePlayer,
} from '@/shared/player/usePlayer';
import type { Moment } from '@/shared/share-link';
import type { IEpisodeInfo } from '@/types';
import styles from './Chapters.module.css';

export function Chapters({
  episode,
  shared,
}: {
  episode: IEpisodeInfo;
  shared?: Exclude<Moment, { kind: 'time' }>;
}) {
  const { t } = useTranslation();
  const heading = useId();
  const { chapters, source, loading } = useChapters(episode);
  const withAccount = useAccountPlayback();
  const seek = usePlayer(getSeekOrStartAt);
  const position = usePlayer((state) =>
    sameEpisode(getCurrentEpisode(state), episode) ? state.seekPosition : null,
  );
  const measured = usePlayer((state) =>
    sameEpisode(getCurrentEpisode(state), episode) ? state.duration : 0,
  );
  const duration = measured || episode.duration || 0;
  const current =
    position === null ? -1 : currentChapterIndex(chapters, position);
  const marked = shared ? currentChapterIndex(chapters, shared.start) : -1;
  const note =
    shared &&
    t(shared.kind === 'clip' ? 'share.inChapter' : 'share.sharedChapter', {
      start: formatSecondsToTimestamp(shared.start),
      end: formatSecondsToTimestamp(shared.end),
    });

  if (!loading && !chapters.length) return null;

  return (
    <section aria-labelledby={heading} className={styles.chapters}>
      <h2 id={heading} className={styles.heading}>
        <span>{t('chapters.title')}</span>
        {chapters.length > 0 && <span>{chapters.length}</span>}
      </h2>
      <p role="status" className={styles.status}>
        {loading
          ? t('chapters.loading')
          : source === 'shownotes'
            ? t('chapters.fallback')
            : ''}
      </p>
      <ol className={styles.list}>
        {chapters.map((chapter, index) => {
          const title =
            chapter.title || t('chapters.untitled', { number: index + 1 });
          const timestamp = formatSecondsToTimestamp(chapter.start);
          const end = chapterEnd(chapters, index, duration);
          const length = end > chapter.start ? end - chapter.start : 0;
          const played = position !== null && position >= end && end > 0;
          const meta = [
            length ? formatDuration(t, length) : null,
            played
              ? t('podcast.played')
              : index === current && position !== null
                ? t('player.remaining', {
                    time: formatDuration(t, end - position),
                  })
                : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={chapter.start}>
              <button
                type="button"
                aria-current={current === index ? 'true' : undefined}
                data-played={played}
                data-shared={index === marked}
                aria-label={t('chapters.seek', { title, timestamp })}
                onClick={() =>
                  withAccount(episode, () => seek(episode, chapter.start))
                }
              >
                <span className={styles.timestamp}>{timestamp}</span>
                <span className={styles.text}>
                  <span className={styles.title}>{title}</span>
                  {meta && <span className={styles.meta}>{meta}</span>}
                  {index === marked && (
                    <span className={styles.shared}>{note}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
