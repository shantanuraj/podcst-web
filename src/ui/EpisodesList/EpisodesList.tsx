'use client';

import React, { useCallback, useRef, useState } from 'react';
import { useVirtual } from 'react-virtual';
import { IEpisodeInfo } from '@/types';
import { EpisodeItem } from './EpisodeItem';

import styles from './EpisodesList.module.css';
import { Icon } from '@/ui/icons/svg/Icon';
import { useEpisodesFilter } from './useEpisodesFilter';

interface EpisodesListProps {
  className?: string;
  children?: React.ReactNode;
  episodes: IEpisodeInfo[];
}

type SortPreference =
  | 'releaseAsc'
  | 'releaseDesc'
  | 'titleAsc'
  | 'titleDesc'
  | 'lengthAsc'
  | 'lengthDesc';

const sortOptionsMap: Record<SortPreference, { value: SortPreference; title: string }> = {
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

export function EpisodesList({ className = '', children, episodes = [] }: EpisodesListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [sortPreference, setSortPreference] = useState<SortPreference>(
    sortOptionsMap.releaseDesc.value,
  );
  const [query, setQuery] = useState('');
  const onSortChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSortPreference(e.target.value as SortPreference);
  }, []);
  const onQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  }, []);

  const filteredEpisodes = useEpisodesFilter(episodes, sortPreference, query);

  const { totalSize, virtualItems } = useVirtual<HTMLDivElement | null>({
    size: filteredEpisodes.length || 0,
    parentRef: containerRef,
    estimateSize: getRowHeight,
    overscan: 5,
  });

  const shouldUseVirtualList = filteredEpisodes.length > 750;

  return (
    <div className={`${styles.container} ${className}`} ref={containerRef}>
      {children}
      <div className={styles.episodeListOptions}>
        <div className={styles.episodeListCount}>
          {episodes.length} total {`${episodes.length !== 1 ? 'episodes' : 'episode'}`}
        </div>
        <div className={styles.episodeListSearch}>
          <Icon icon="search" />
          <input onChange={onQueryChange} placeholder="Search episodes" />
        </div>
        <div className={styles.episodeListOptionsSort}>
          <span>Sort by:</span>
          <select onChange={onSortChange} data-surface={4}>
            {sortOptions.map(({ title, value }) => (
              <option key={value} value={value}>
                {title}
              </option>
            ))}
          </select>
        </div>
      </div>
      {shouldUseVirtualList ? (
        <ul className={styles.list} style={{ height: `${totalSize}px` }}>
          {virtualItems.map(({ index, start }) => {
            const episode = filteredEpisodes[index];
            return (
              <EpisodeListItem
                key={episode.guid || `${index}-${episode.title}`}
                episode={episode}
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
  index: number;
  start?: number;
}

function EpisodeListItem({ episode, index, start }: EpisodeListItemProps) {
  const virtual = start !== undefined;
  return (
    <li
      data-virtual={virtual}
      data-surface={index % 2 === 0 ? 3 : 4}
      style={
        virtual
          ? {
              transform: `translateY(${start}px)`,
            }
          : undefined
      }
    >
      <EpisodeItem episode={episode} />
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
  );
