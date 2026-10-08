'use client';

import { useEffect, useState } from 'react';
import { useRelated } from '@/data/discover';
import { i18n } from '@/i18.conf';
import { useTranslation } from '@/shared/i18n';
import { getPodcastHref } from '@/shared/links';
import { readRegion } from '@/shared/region';
import { ProxiedImage } from '@/ui/Image';
import { PageLink } from '@/ui/PageLink/PageLink';
import styles from './Related.module.css';

export function Related({ podcastId }: { podcastId: string }) {
  const { t } = useTranslation();
  const [region, setRegion] = useState<string | null>(null);
  useEffect(() => setRegion(readRegion() ?? i18n.defaultLocale), []);
  const { data = [] } = useRelated(podcastId, region);
  if (!data.length) return null;
  return (
    <aside className={styles.related}>
      <h2 className={styles.eyebrow}>{t('podcast.alsoFollow')}</h2>
      <ul>
        {data.map((podcast) => (
          <li key={podcast.id}>
            <PageLink
              href={getPodcastHref(podcast)}
              loading="podcast"
              className={styles.row}
            >
              <ProxiedImage
                alt=""
                src={podcast.thumbnail || podcast.cover}
                sizes="44px"
                loading="lazy"
              />
              <span className={styles.text}>
                <span className={styles.title}>{podcast.title}</span>
                <span className={styles.author}>{podcast.author}</span>
              </span>
            </PageLink>
          </li>
        ))}
      </ul>
    </aside>
  );
}
