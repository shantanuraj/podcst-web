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
  const utcDate = pub.toUTCString();
  const day = pub.getDate();
  const month = pub.toLocaleDateString('default', { month: 'short' }).slice(0, 3);
  const minutes = Math.floor((duration || 0) / 60);
  const minutesSuffix = `min${minutes > 1 ? 's' : ''}`;

  return (
    <Link
      href={`/episode/${encodeURIComponent(feed)}/${encodeURIComponent(guid)}`}
      className={styles.container}
    >
      <img loading="lazy" className={styles.image} src={episodeArt || cover} alt={title} />
      <div className={styles.infoParent}>
        <div className={styles.info} title={utcDate}>
          <span>{month}</span>
          <span>{day}</span>
        </div>
        <span title={title} className={styles.title}>
          {title}
        </span>
        <div className={styles.info}>
          <span>{minutes || ''}</span>
          <span>{minutes ? minutesSuffix : ''}</span>
        </div>
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
