'use client';

import { useTranslation } from '@/shared/i18n';
import { getEpisodesQueue, usePlayer } from '@/shared/player/usePlayer';
import { EpisodesList } from '@/ui/EpisodesList';

import styles from './Queue.module.css';

const QueuePage = () => {
  const { t } = useTranslation();
  const episodes = usePlayer(getEpisodesQueue);

  if (episodes.length === 0) {
    return <div className={styles.empty}>{t('queue.empty')}</div>;
  }

  return (
    <EpisodesList episodes={episodes}>
      <header className={styles.header}>
        <h1>{t('queue.title')}</h1>
      </header>
    </EpisodesList>
  );
};

export default QueuePage;
