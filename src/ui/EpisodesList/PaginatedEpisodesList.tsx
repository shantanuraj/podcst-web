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

const sortOptionsMap: Record<
  SortPreference,
  { value: SortPreference; title: string }
> = {
  releaseDesc: {
    title: 'Release date (New → Old)',
    value: 'releaseDesc',
  },
  releaseAsc: {
    title: 'Release date (Old → New)',
    value: 'releaseAsc',
  },
  titleAsc: {
    title: 'Title (A → Z)',
    value: 'titleAsc',
  },
  titleDesc: {
    title: 'Title (Z → A)',
    value: 'titleDesc',
  },
  lengthAsc: {
    title: 'Duration (Short → Long)',
    value: 'lengthAsc',
  },
  lengthDesc: {
    title: 'Duration (Long → Short)',
    value: 'lengthDesc',
  },
};
const sortOptions = Object.values(sortOptionsMap);

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
  const [sortPreference, setSortPreference] = useState<SortPreference>(
    sortOptionsMap.releaseDesc.value,
  );
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

  return (
    <div className={`${styles.container} ${className}`} ref={containerRef}>
      {children}
      <div className={styles.header}>
        <div className={styles.count}>
          {debouncedSearch ? (
            <>
              {allEpisodes.length} of {podcast.episodeCount}{' '}
              {podcast.episodeCount !== 1 ? 'episodes' : 'episode'}
            </>
          ) : (
            <>
              {podcast.episodeCount}{' '}
              {podcast.episodeCount !== 1 ? 'episodes' : 'episode'}
            </>
          )}
        </div>
        <div className={styles.search}>
          <input
            onChange={onSearchChange}
            value={searchQuery}
            placeholder="Search episodes"
          />
        </div>
        <div className={styles.sort}>
          <span>Sort:</span>
          <select onChange={onSortChange} value={sortPreference}>
            {sortOptions.map(({ title, value }) => (
              <option key={value} value={value}>
                {title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading && !initialData && (
        <div className={styles.loading}>Loading episodes...</div>
      )}

      {isError && <div className={styles.error}>Failed to load episodes</div>}

      <ul className={styles.list}>
        {allEpisodes.map((episode, index) => (
          <EpisodeListItem
            key={episode.id || episode.guid || `${index}-${episode.title}`}
            episode={episode}
            podcast={podcast}
            index={index}
          />
        ))}
      </ul>

      {/* Load more trigger */}
      <div ref={loadMoreRef} className={styles.loadMore}>
        {isFetchingNextPage && <span>Loading more...</span>}
        {!hasNextPage && allEpisodes.length > 0 && totalCount > 20 && (
          <span>All episodes loaded</span>
        )}
      </div>
    </div>
  );
}

interface EpisodeListItemProps {
  episode: IEpisodeInfo;
  podcast: IPodcastInfo;
  index: number;
}

function EpisodeListItem({ episode, podcast }: EpisodeListItemProps) {
  // Adapt IPodcastInfo to what EpisodeItem expects
  const podcastData = {
    ...podcast,
    episodes: [],
    feed: podcast.feed,
  };

  return (
    <li>
      <EpisodeItem episode={episode} podcast={podcastData} />
    </li>
  );
}
