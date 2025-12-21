import Link from 'next/link';
import { memo } from 'react';

import { PlayButton } from '@/ui/Button/PlayButton';
import { QueueButton } from '@/ui/Button/QueueButton';
import { IEpisodeInfo } from '@/types';

import styles from './EpisodeItem.module.css';

type EpisodeItemProps = {
  episode: IEpisodeInfo;
};

function EpisodeItem({ episode }: EpisodeItemProps) {
  const { cover, episodeArt, feed, guid, title, published, duration } = episode;

  const pub = new Date(published || Date.now());
  const day = pub.getDate();
  const month = pub.toLocaleDateString('default', { month: 'short' }).toUpperCase();
  const minutes = Math.floor((duration || 0) / 60);

  return (
    <Link
      href={`/episode/${encodeURIComponent(feed)}/${encodeURIComponent(guid)}`}
      className={styles.container}
    >
      <div className={styles.artwork}>
        <img loading="lazy" src={episodeArt || cover} alt="" />
      </div>
      <div className={styles.meta}>
        <div className={styles.date}>{month}</div>
        <div className={styles.day}>{day}</div>
      </div>
      <div className={styles.content}>
        <h3 className={styles.title}>{title}</h3>
        {minutes > 0 && <div className={styles.duration}>{minutes} min</div>}
      </div>
      <div className={styles.actions}>
        <PlayButton icon episode={episode} />
        <QueueButton episode={episode} />
      </div>
    </Link>
  );
}

const MemoizedEpisodeItem = memo(EpisodeItem);

export { MemoizedEpisodeItem as EpisodeItem };
