'use client';

import { useEffect, useRef, useState } from 'react';
import {
  type EpisodeSortDir,
  type EpisodeSortField,
  useEpisodesInfinite,
} from '@/data/feed';
import { usePodcastProgress } from '@/data/progress';
import { useSession } from '@/shared/auth/useAuth';
import { useTranslation } from '@/shared/i18n';
import type { IPodcastInfo } from '@/types';
import { EpisodeRow } from './EpisodeRow';
import styles from './PaginatedEpisodesList.module.css';

type SortPreference =
  | 'releaseDesc'
  | 'releaseAsc'
  | 'titleAsc'
  | 'titleDesc'
  | 'lengthAsc'
  | 'lengthDesc';

const sorts: Record<
  SortPreference,
  { sortBy: EpisodeSortField; sortDir: EpisodeSortDir }
> = {
  releaseDesc: { sortBy: 'published', sortDir: 'desc' },
  releaseAsc: { sortBy: 'published', sortDir: 'asc' },
  titleAsc: { sortBy: 'title', sortDir: 'asc' },
  titleDesc: { sortBy: 'title', sortDir: 'desc' },
  lengthAsc: { sortBy: 'duration', sortDir: 'asc' },
  lengthDesc: { sortBy: 'duration', sortDir: 'desc' },
};

export function PaginatedEpisodesList({ podcast }: { podcast: IPodcastInfo }) {
  const { t } = useTranslation();
  const { data: user } = useSession();
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [sort, setSort] = useState<SortPreference>('releaseDesc');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [unplayed, setUnplayed] = useState(false);
  const progress = usePodcastProgress(podcast.id);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useEpisodesInfinite({
    podcastId: podcast.id,
    search: search || undefined,
    unplayed: !!user && unplayed,
    ...sorts[sort],
    limit: 20,
  });

  useEffect(() => {
    if (!loadMoreRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage)
          void fetchNextPage();
      },
      { rootMargin: '200px' },
    );
    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const episodes = data?.pages.flatMap((page) => page.episodes) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  return (
    <section className={styles.episodes}>
      <div className={styles.head}>
        <h2 className={styles.heading}>{t('podcast.episodes')}</h2>
        <div className={styles.controls}>
          <label className={styles.search}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder={t('podcast.searchShow')}
              aria-label={t('podcast.searchShow')}
            />
          </label>
          {user && (
            <button
              type="button"
              className={styles.control}
              aria-pressed={unplayed}
              onClick={() => setUnplayed((value) => !value)}
            >
              {t('podcast.unplayed')}
            </button>
          )}
          <select
            className={styles.control}
            value={sort}
            onChange={(event) =>
              setSort(event.currentTarget.value as SortPreference)
            }
            aria-label={t('podcast.sort')}
          >
            {(Object.keys(sorts) as SortPreference[]).map((value) => (
              <option key={value} value={value}>
                {t(`podcast.sortOptions.${value}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {(search || unplayed) && !isLoading && (
        <p className={styles.status} role="status">
          {t('podcast.episodeSearchCount', {
            count: total,
            total: podcast.episodeCount,
          })}
        </p>
      )}
      {isLoading && (
        <p className={styles.status}>{t('podcast.loadingEpisodes')}</p>
      )}
      {isError && <p className={styles.status}>{t('podcast.loadError')}</p>}
      <ul>
        {episodes.map((episode) => (
          <EpisodeRow
            key={episode.id ?? episode.guid}
            episode={episode}
            progress={episode.id ? progress.get(episode.id) : undefined}
          />
        ))}
      </ul>
      <div ref={loadMoreRef} className={styles.status}>
        {isFetchingNextPage && t('podcast.loadingMore')}
      </div>
    </section>
  );
}
