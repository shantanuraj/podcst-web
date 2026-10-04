'use client';

import { memo } from 'react';
import { localeForLanguage } from '@/messages';
import { useTranslation } from '@/shared/i18n';
import { getEpisodeHref } from '@/shared/links';
import type { IEpisodeInfo } from '@/types';
import { PlayButton } from '@/ui/Button/PlayButton';
import { QueueButton } from '@/ui/Button/QueueButton';
import { StarButton } from '@/ui/Button/StarButton';
import { ProxiedImage } from '@/ui/Image';
import { PageLink } from '@/ui/PageLink/PageLink';

import styles from './EpisodeItem.module.css';

type EpisodeItemProps = {
  episode: IEpisodeInfo;
  podcastId?: number;
};

function EpisodeItem({ episode, podcastId }: EpisodeItemProps) {
  const { cover, episodeArt, title, published, duration } = episode;
  const { language } = useTranslation();
  const locale = localeForLanguage[language];

  const pub = new Date(published || Date.now());
  const day = pub.getDate();
  const month = pub
    .toLocaleDateString(locale, { month: 'short' })
    .toUpperCase();
  const minutes = Math.floor((duration || 0) / 60);

  return (
    <div className={styles.container}>
      <PageLink
        href={getEpisodeHref(episode, podcastId)}
        className={styles.link}
        loading="podcast"
      >
        <div className={styles.artwork}>
          <ProxiedImage
            loading="lazy"
            src={episodeArt || cover || undefined}
            privateSource={episode.isPrivate}
            alt=""
            sizes="(max-width: 768px) 56px, 64px"
          />
        </div>
        <div className={styles.meta}>
          <div className={styles.date}>{month}</div>
          <div className={styles.day}>{day}</div>
        </div>
        <div className={styles.content}>
          <h3 className={styles.title}>{title}</h3>
          {minutes > 0 && <div className={styles.duration}>{minutes} min</div>}
        </div>
      </PageLink>
      <div className={styles.actions}>
        <StarButton episode={episode} />
        <PlayButton icon episode={episode} />
        <QueueButton episode={episode} />
      </div>
    </div>
  );
}

const MemoizedEpisodeItem = memo(EpisodeItem);

export { MemoizedEpisodeItem as EpisodeItem };
