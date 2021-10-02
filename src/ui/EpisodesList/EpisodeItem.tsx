import Link from 'next/link';
import { memo } from 'react';

import { PlayButtonIcon } from '../Button/PlayButtonIcon';
import { IEpisodeInfo } from '../../types';

import styles from './EpisodeItem.module.css';
import { Icon } from '../icons/svg/Icon';

type EpisodeItemProps = {
  episode: IEpisodeInfo;
};

function EpisodeItem({ episode }: EpisodeItemProps) {
  const { cover, episodeArt, feed, guid, title, published, duration } = episode;

  const pub = new Date(published || Date.now());
  const utcDate = pub.toUTCString();
  const day = pub.getDate();
  const month = pub.toLocaleDateString('default', { month: 'short' });
  const minutes = Math.floor((duration || 0) / 60);
  const minutesSuffix = `min${minutes > 1 ? 's' : ''}`;

  return (
    <Link
      href={{
        pathname: '/episode',
        query: { feed, guid },
      }}
    >
      <a className={styles.container}>
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
          <PlayButtonIcon episode={episode} />
          <div className={styles.queue}>
            <Icon className="actionIcon" icon="queue" size={25}/>
          </div>
        </div>
      </a>
    </Link>
  );
}

const MemoizedEpisodeItem = memo(EpisodeItem);

export { MemoizedEpisodeItem as EpisodeItem };
