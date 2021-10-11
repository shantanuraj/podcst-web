import { getEpisodesQueue, usePlayer } from '../../shared/player/usePlayer';
import { EpisodesList } from '../../ui/EpisodesList';

import styles from './Queue.module.css';

const QueuePage = () => {
  const episodes = usePlayer(getEpisodesQueue);

  return (
    <EpisodesList episodes={episodes}>
      <div className={styles.root}>
        {episodes.length === 0 && 'Add some episodes to queue to see them here'}
        {episodes.length > 0 && <h1>Queue</h1>}
      </div>
    </EpisodesList>
  );
};

export default QueuePage;
