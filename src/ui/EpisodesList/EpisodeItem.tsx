import Link from 'next/link';
import { memo } from 'react';

import { PlayButton } from '../Button/PlayButton';
import { IEpisodeInfo } from '../../types';

import styles from './EpisodeItem.module.css';

type EpisodeItemProps = {
  episode: IEpisodeInfo;
};

function EpisodeItem({ episode }: EpisodeItemProps) {
  const { cover, episodeArt, feed, title, published, duration } = episode;

  const pub = new Date(published || Date.now());
  const day = pub.getDate();
  const month = pub.toLocaleDateString('default', { month: 'short' });
  const minutes = Math.floor((duration || 0) / 60);
  const minutesSuffix = `min${minutes > 1 ? 's' : ''}`;

  return (
    <Link href={`/episode?feed=${feed}&title=${title}`}>
      <a className={styles.container}>
        <img loading="lazy" className={styles.image} src={episodeArt || cover} alt={title} />
        <div className={styles.info}>
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
        <PlayButton />
      </a>
    </Link>
  );
}

const MemoizedEpisodeItem = memo(EpisodeItem);

export { MemoizedEpisodeItem as EpisodeItem };
