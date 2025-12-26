'use client';

import { getEpisodesQueue, usePlayer } from '@/shared/player/usePlayer';
import { EpisodesList } from '@/ui/EpisodesList';

import styles from './Queue.module.css';

const QueuePage = () => {
  const episodes = usePlayer(getEpisodesQueue);

  if (episodes.length === 0) {
    return (
      <div className={styles.empty}>
        Add some episodes to queue to see them here
      </div>
    );
  }

  return (
    <EpisodesList episodes={episodes}>
      <header className={styles.header}>
        <h1>Queue</h1>
      </header>
    </EpisodesList>
  );
};

export default QueuePage;
