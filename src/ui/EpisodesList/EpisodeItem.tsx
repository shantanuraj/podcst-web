import { memo } from 'react';

import { SpaLink } from '@/shared/spa';
import type { IEpisodeInfo, IPodcastEpisodesInfo } from '@/types';
import { PlayButton } from '@/ui/Button/PlayButton';
import { QueueButton } from '@/ui/Button/QueueButton';
import { getEpisodeHref } from '@/shared/links';
import { ProxiedImage } from '@/ui/Image';

import styles from './EpisodeItem.module.css';

type EpisodeItemProps = {
  episode: IEpisodeInfo;
  podcast?: IPodcastEpisodesInfo;
};

function EpisodeItem({ episode, podcast }: EpisodeItemProps) {
  const { cover, episodeArt, title, published, duration } = episode;

  const pub = new Date(published || Date.now());
  const day = pub.getDate();
  const month = pub.toLocaleDateString('default', { month: 'short' }).toUpperCase();
  const minutes = Math.floor((duration || 0) / 60);

  return (
    <SpaLink href={getEpisodeHref(episode, podcast)} className={styles.container}>
      <div className={styles.artwork}>
        <ProxiedImage loading="lazy" src={episodeArt || cover || undefined} alt="" />
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
    </SpaLink>
  );
}

const MemoizedEpisodeItem = memo(EpisodeItem);

export { MemoizedEpisodeItem as EpisodeItem };
