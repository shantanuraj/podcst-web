'use client';

import { movement } from '@/shared/discovery';
import { useTranslation } from '@/shared/i18n';
import { getPodcastHref } from '@/shared/links';
import type { IPodcast } from '@/types';
import { ProxiedImage } from '@/ui/Image';
import { PageLink } from '@/ui/PageLink/PageLink';
import styles from './Discover.module.css';

export function ChartRows({
  podcasts,
  offset,
}: {
  podcasts: readonly IPodcast[];
  offset: number;
}) {
  const { t } = useTranslation();
  return (
    <ol className={styles.chartRows} start={offset + 1}>
      {podcasts.map((podcast, index) => {
        const move = movement(offset + index, podcast.previousRank);
        return (
          <li key={podcast.id}>
            <PageLink
              href={getPodcastHref(podcast)}
              loading="podcast"
              className={styles.chartRow}
            >
              <span className={styles.rank}>{offset + index + 1}</span>
              <ProxiedImage
                alt=""
                src={podcast.thumbnail || podcast.cover}
                sizes="36px"
                loading="lazy"
                className={styles.chartArt}
              />
              <span className={styles.chartText}>
                <span className={styles.chartTitle}>{podcast.title}</span>
                <span className={styles.meta}>{podcast.author}</span>
              </span>
              <span className={styles.chartGenre}>{podcast.genre?.name}</span>
              <span
                className={styles.movement}
                data-kind={move?.kind}
                aria-label={
                  move?.kind === 'up'
                    ? t('discover.movedUp', { count: move.by })
                    : move?.kind === 'down'
                      ? t('discover.movedDown', { count: move.by })
                      : move?.kind === 'same'
                        ? t('discover.unchanged')
                        : move?.kind === 'new'
                          ? t('discover.newEntry')
                          : undefined
                }
              >
                {move?.kind === 'up'
                  ? `▲ ${move.by}`
                  : move?.kind === 'down'
                    ? `▼ ${move.by}`
                    : move?.kind === 'same'
                      ? '—'
                      : move?.kind === 'new'
                        ? t('discover.newEntry').toUpperCase()
                        : ''}
              </span>
            </PageLink>
          </li>
        );
      })}
    </ol>
  );
}
