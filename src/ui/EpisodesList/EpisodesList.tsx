import { IEpisodeInfo } from '../../types';

import styles from './EpisodesList.module.css';

type EpisodesListProps = {
  episodes: IEpisodeInfo[];
};

export function EpisodesList({ episodes }: EpisodesListProps) {
  return (
    <ul className={styles.list}>
      {episodes.map((episode, idx) => (
        <li key={`${idx}-${episode.title}`}>
          {episode.title} - {episode.author}
        </li>
      ))}
    </ul>
  );
}
