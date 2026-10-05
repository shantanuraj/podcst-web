'use client';

import { SubscribeButton } from '@/components/SubscribeButton/SubscribeButton';
import { useTranslation } from '@/shared/i18n';
import { getPodcastHref } from '@/shared/links';
import { plainText } from '@/shared/plain-text';
import type { IEpisodeInfo, IPodcastInfo } from '@/types';
import { ArtworkBackdrop } from '@/ui/ArtworkBackdrop/ArtworkBackdrop';
import { PlayButton } from '@/ui/Button/PlayButton';
import { ProxiedImage } from '@/ui/Image';
import { PageLink } from '@/ui/PageLink/PageLink';
import styles from './Discover.module.css';

export function LeadStory({
  podcast,
  latest,
}: {
  podcast: IPodcastInfo;
  latest: IEpisodeInfo | null;
}) {
  const { t } = useTranslation();
  return (
    <article className={styles.lead}>
      <ArtworkBackdrop
        src={podcast.cover}
        privateSource={podcast.isPrivate}
        className={styles.tint}
      />
      <PageLink
        href={getPodcastHref(podcast)}
        loading="podcast"
        className={styles.leadCover}
      >
        <ProxiedImage
          alt=""
          src={podcast.cover}
          sizes="(max-width: 767px) 40vw, 300px"
          loading="eager"
          fetchPriority="high"
        />
      </PageLink>
      <div className={styles.leadText}>
        <p className={styles.eyebrowAccent}>{t('discover.numberOne')}</p>
        <h2 className={styles.leadTitle}>
          <PageLink href={getPodcastHref(podcast)} loading="podcast">
            {podcast.title}
          </PageLink>
        </h2>
        <p className={styles.leadByline}>
          {[podcast.author, podcast.genre?.name].filter(Boolean).join(' · ')}
        </p>
        {podcast.description && (
          <p className={styles.leadDescription}>
            {plainText(podcast.description)}
          </p>
        )}
        <div className={styles.leadActions}>
          {latest && (
            <PlayButton episode={latest} label={t('discover.playLatest')} />
          )}
          <SubscribeButton info={{ ...podcast, episodes: [] }} />
        </div>
      </div>
    </article>
  );
}
