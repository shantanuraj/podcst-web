'use client';

import { memo } from 'react';
import { localeForLanguage } from '@/messages';
import { useTranslation } from '@/shared/i18n';
import { getEpisodeHref } from '@/shared/links';
import { plainText } from '@/shared/plain-text';
import { sameEpisode } from '@/shared/player/episode-identity';
import { formatDuration } from '@/shared/player/formatTime';
import { getCurrentEpisode, usePlayer } from '@/shared/player/usePlayer';
import type { EpisodeProgress, IEpisodeInfo } from '@/types';
import { PlayButton } from '@/ui/Button/PlayButton';
import { QueueButton } from '@/ui/Button/QueueButton';
import { StarButton } from '@/ui/Button/StarButton';
import { PageLink } from '@/ui/PageLink/PageLink';
import styles from './EpisodeRow.module.css';

function useListening(episode: IEpisodeInfo, saved?: EpisodeProgress) {
  const live = usePlayer((state) =>
    sameEpisode(getCurrentEpisode(state), episode)
      ? state.seekPosition
      : undefined,
  );
  const duration = episode.duration || 0;
  const position = live ?? saved?.position ?? 0;
  return {
    completed: live === undefined && !!saved?.completed,
    position,
    fraction: duration > 0 ? Math.min(position / duration, 1) : 0,
    left: Math.max(duration - position, 0),
  };
}

function EpisodeRow({
  episode,
  progress,
}: {
  episode: IEpisodeInfo;
  progress?: EpisodeProgress;
}) {
  const { t, language } = useTranslation();
  const locale = localeForLanguage[language];
  const listening = useListening(episode, progress);
  const published = episode.published ? new Date(episode.published) : null;
  const summary = plainText(episode.summary);
  const started = !listening.completed && listening.position > 0;

  return (
    <li className={styles.row}>
      <div className={styles.date} aria-hidden="true">
        {published && (
          <>
            <span className={styles.month}>
              {published.toLocaleDateString(locale, { month: 'short' })}
            </span>
            <span className={styles.day}>{published.getDate()}</span>
          </>
        )}
      </div>
      <div className={styles.text}>
        <PageLink
          href={getEpisodeHref(episode)}
          loading="podcast"
          className={styles.title}
        >
          {episode.title}
        </PageLink>
        {summary && <p className={styles.summary}>{summary}</p>}
      </div>
      <div className={styles.status}>
        <span
          data-state={
            listening.completed ? 'played' : started ? 'started' : undefined
          }
        >
          {listening.completed
            ? t('podcast.played')
            : started
              ? t('player.remaining', {
                  time: formatDuration(t, listening.left),
                })
              : episode.duration
                ? formatDuration(t, episode.duration)
                : ''}
        </span>
        {started && (
          <span className={styles.bar} aria-hidden="true">
            <span style={{ width: `${listening.fraction * 100}%` }} />
          </span>
        )}
      </div>
      <div className={styles.actions}>
        <StarButton episode={episode} />
        <QueueButton
          episode={episode}
          className={styles.queue}
          aria-label={t('podcast.addToQueue')}
        />
        <PlayButton
          icon
          episode={episode}
          className={styles.play}
          aria-label={`${t('player.play')} ${episode.title}`}
        />
      </div>
    </li>
  );
}

const Memoized = memo(EpisodeRow);

export { Memoized as EpisodeRow };
