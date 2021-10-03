import { useRef } from 'react';
import { useVirtual } from 'react-virtual';
import { IEpisodeInfo } from '../../types';
import { EpisodeItem } from './EpisodeItem';

import styles from './EpisodesList.module.css';
import { Icon } from '../icons/svg/Icon';
import { FeatureToggle } from '../../shared/features';

type EpisodesListProps = {
  className?: string;
  children?: React.ReactNode;
  episodes: IEpisodeInfo[];
};

export function EpisodesList({ className = '', children, episodes }: EpisodesListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { totalSize, virtualItems } = useVirtual<HTMLDivElement>({
    size: episodes?.length || 0,
    parentRef: containerRef,
    estimateSize: getRowHeight,
    overscan: 5,
  });

  return (
    <div className={`${styles.container} ${className}`} ref={containerRef}>
      {children}
      <FeatureToggle feature="episodesFilter">
        <div className={styles.episodeListOptions}>
          <div className={styles.episodeListCount}>
            {episodes.length} total {`${episodes.length !== 1 ? 'episodes' : 'episode'}`}
          </div>
          <div className={styles.episodeListSearch}>
            <Icon icon="search" />
            <input placeholder="Search episodes" />
          </div>
          <div className={styles.episodeListOptionsSort}>
            <span>Sort by:</span>
            <select>
              <option>Latest episodes</option>
              <option>Earliest episodes</option>
              <option>Duration</option>
            </select>
          </div>
        </div>
      </FeatureToggle>
      <ul className={styles.list} style={{ height: `${totalSize}px` }}>
        {virtualItems.map(({ index, start }) => {
          const episode = episodes[index];
          return (
            <li
              className={index % 2 === 0 ? styles.even : undefined}
              key={`${index}-${episode.title}`}
              style={{
                transform: `translateY(${start}px)`,
              }}
            >
              <EpisodeItem episode={episode} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const getRowHeight = () =>
  parseInt(
    getComputedStyle(document.documentElement)
      .getPropertyValue('--dimen-episode-list-item-size')
      .trim()
      .replace('px', ''),
  );
