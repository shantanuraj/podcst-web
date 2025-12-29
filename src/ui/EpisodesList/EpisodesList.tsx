'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import type React from 'react';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import type { IEpisodeInfo, IPodcastEpisodesInfo } from '@/types';
import { EpisodeItem } from './EpisodeItem';
import styles from './EpisodesList.module.css';
import { useEpisodesFilter } from './useEpisodesFilter';

interface EpisodesListProps {
  className?: string;
  children?: React.ReactNode;
  episodes: IEpisodeInfo[];
  podcast?: IPodcastEpisodesInfo;
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

export function EpisodesList({
  className = '',
  children,
  episodes = [],
  podcast,
}: EpisodesListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [sortPreference, setSortPreference] =
    useState<SortPreference>('releaseDesc');
  const [query, setQuery] = useState('');
  const onSortChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setSortPreference(e.target.value as SortPreference);
    },
    [],
  );
  const onQueryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value);
    },
    [],
  );

  const filteredEpisodes = useEpisodesFilter(episodes, sortPreference, query);
  const { t } = useTranslation();

  const virtualizer = useVirtualizer({
    count: filteredEpisodes.length || 0,
    getScrollElement: () => containerRef.current,
    estimateSize: getRowHeight,
    overscan: 5,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  const shouldUseVirtualList = filteredEpisodes.length > 750;

  return (
    <div className={`${styles.container} ${className}`} ref={containerRef}>
      {children}
      <div className={styles.header}>
        <div className={styles.count}>
          {query
            ? t('podcast.episodeSearchCount', {
                count: filteredEpisodes.length,
                total: episodes.length,
              })
            : t('podcast.episodeCount', {
                count: episodes.length,
              })}
        </div>
        <div className={styles.search}>
          <input
            onChange={onQueryChange}
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
      {shouldUseVirtualList ? (
        <ul
          className={styles.list}
          style={{ height: `${totalSize}px` }}
          suppressHydrationWarning
        >
          {virtualItems.map(({ index, start }) => {
            const episode = filteredEpisodes[index];
            return (
              <EpisodeListItem
                key={episode.guid || `${index}-${episode.title}`}
                episode={episode}
                podcastId={podcast?.id}
                index={index}
                start={start}
              />
            );
          })}
        </ul>
      ) : (
        <ul className={styles.list}>
          {filteredEpisodes.map((episode, index) => {
            return (
              <EpisodeListItem
                key={episode.guid || `${index}-${episode.title}`}
                episode={episode}
                podcastId={podcast?.id}
                index={index}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface EpisodeListItemProps {
  episode: IEpisodeInfo;
  podcastId?: number;
  index: number;
  start?: number;
}

function EpisodeListItem({
  episode,
  podcastId,
  index: _index,
  start,
}: EpisodeListItemProps) {
  const virtual = start !== undefined;
  return (
    <li
      data-virtual={virtual}
      style={
        virtual
          ? {
              transform: `translateY(${start}px)`,
            }
          : undefined
      }
    >
      <EpisodeItem episode={episode} podcastId={podcastId} />
    </li>
  );
}

const getRowHeight = () =>
  parseInt(
    'getComputedStyle' in global
      ? getComputedStyle(document.documentElement)
          .getPropertyValue('--dimen-episode-list-item-size')
          .trim()
          .replace('px', '')
      : '84',
    10,
  );
