import { useRef } from 'react';
import { useVirtual } from 'react-virtual';
import { IEpisodeInfo } from '../../types';
import { EpisodeItem } from './EpisodeItem';

import styles from './EpisodesList.module.css';

type EpisodesListProps = {
  episodes: IEpisodeInfo[];
};

export function EpisodesList({ episodes }: EpisodesListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { totalSize, virtualItems } = useVirtual<HTMLDivElement>({
    size: episodes.length,
    parentRef: containerRef,
    estimateSize: getRowHeight,
    overscan: 5,
  });

  return (
    <div className={styles.container} ref={containerRef}>
      <ul className={styles.list} style={{ height: `${totalSize}px` }}>
        {virtualItems.map(({ index, start }) => {
          const episode = episodes[index];
          return (
            <li
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

const getRowHeight = () => 84;
