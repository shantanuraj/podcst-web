'use client';

import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type EpisodeSortDir,
  type EpisodeSortField,
  useEpisodesInfinite,
} from '@/data/feed';
import type { IEpisodeInfo, IPaginatedEpisodes, IPodcastInfo } from '@/types';
import { EpisodeItem } from './EpisodeItem';

import styles from './EpisodesList.module.css';
import { useTranslation } from '@/shared/i18n';

interface PaginatedEpisodesListProps {
  className?: string;
  children?: React.ReactNode;
  podcastId: number;
  podcast: IPodcastInfo;
  initialData?: IPaginatedEpisodes;
}

type SortPreference =
  | 'releaseAsc'
  | 'releaseDesc'
  | 'titleAsc'
  | 'titleDesc'
  | 'lengthAsc'
  | 'lengthDesc';

const sortOptions: SortPreference[] = [
  'releaseDesc',
  'releaseAsc',
  'titleAsc',
  'titleDesc',
  'lengthAsc',
  'lengthDesc',
];

function mapSortPreference(pref: SortPreference): {
  sortBy: EpisodeSortField;
  sortDir: EpisodeSortDir;
} {
  switch (pref) {
    case 'releaseDesc':
      return { sortBy: 'published', sortDir: 'desc' };
    case 'releaseAsc':
      return { sortBy: 'published', sortDir: 'asc' };
    case 'titleAsc':
      return { sortBy: 'title', sortDir: 'asc' };
    case 'titleDesc':
      return { sortBy: 'title', sortDir: 'desc' };
    case 'lengthAsc':
      return { sortBy: 'duration', sortDir: 'asc' };
    case 'lengthDesc':
      return { sortBy: 'duration', sortDir: 'desc' };
  }
}

export function PaginatedEpisodesList({
  className = '',
  children,
  podcastId,
  podcast,
  initialData,
}: PaginatedEpisodesListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [sortPreference, setSortPreference] =
    useState<SortPreference>('releaseDesc');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { sortBy, sortDir } = mapSortPreference(sortPreference);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useEpisodesInfinite(
    {
      podcastId,
      search: debouncedSearch || undefined,
      sortBy,
      sortDir,
      limit: 20,
    },
    // Only use initialData when no search and default sort
    !debouncedSearch && sortPreference === 'releaseDesc'
      ? initialData
      : undefined,
  );

  const onSortChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setSortPreference(e.target.value as SortPreference);
    },
    [],
  );

  const onSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
    },
    [],
  );

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (!loadMoreRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1, rootMargin: '100px' },
    );

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const allEpisodes =
    data?.pages.flatMap((page) => page.episodes) ?? initialData?.episodes ?? [];
  const totalCount = data?.pages[0]?.total ?? initialData?.total ?? 0;

  const { t } = useTranslation();

  return (
    <div className={`${styles.container} ${className}`} ref={containerRef}>
      {children}
      <div className={styles.header}>
        <div className={styles.count}>
          {debouncedSearch
            ? t('podcast.episodeSearchCount', {
                count: allEpisodes.length,
                total: podcast.episodeCount,
              })
            : t('podcast.episodeCount', {
                count: podcast.episodeCount,
              })}
        </div>
        <div className={styles.search}>
          <input
            onChange={onSearchChange}
            value={searchQuery}
            placeholder={t('search.episodesPlaceholder')}
          />
        </div>
        <div className={styles.sort}>
          <span>{t('podcast.sort')}</span>
          <select onChange={onSortChange} value={sortPreference}>
            {sortOptions.map((value) => (
              <option key={value} value={value}>
                {t(`podcast.sortOptions.${value}` as any)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading && !initialData && (
        <div className={styles.loading}>{t('podcast.loadingEpisodes')}</div>
      )}

      {isError && <div className={styles.error}>{t('podcast.loadError')}</div>}

      <ul className={styles.list}>
        {allEpisodes.map((episode, index) => (
          <EpisodeListItem
            key={episode.id || episode.guid || `${index}-${episode.title}`}
            episode={episode}
            podcastId={podcast.id}
            index={index}
          />
        ))}
      </ul>

      {/* Load more trigger */}
      <div ref={loadMoreRef} className={styles.loadMore}>
        {isFetchingNextPage && <span>{t('podcast.loadingMore')}</span>}
        {!hasNextPage && allEpisodes.length > 0 && totalCount > 20 && (
          <span>{t('podcast.allLoaded')}</span>
        )}
      </div>
    </div>
  );
}

interface EpisodeListItemProps {
  episode: IEpisodeInfo;
  podcastId?: number;
  index: number;
}

function EpisodeListItem({ episode, podcastId }: EpisodeListItemProps) {
  return (
    <li>
      <EpisodeItem episode={episode} podcastId={podcastId} />
    </li>
  );
}
