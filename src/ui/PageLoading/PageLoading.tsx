'use client';

import { useTranslation } from '@/shared/i18n';
import rowStyles from '@/ui/EpisodesList/EpisodeRow.module.css';
import listStyles from '@/ui/EpisodesList/PaginatedEpisodesList.module.css';
import podcastStyles from '@/ui/PodcastInfo/PodcastInfo.module.css';
import relatedStyles from '@/ui/PodcastInfo/Related.module.css';
import gridStyles from '@/ui/PodcastsGrid/PodcastsGrid.module.css';
import styles from './PageLoading.module.css';

const rows = (length: number) => Array.from({ length }, (_, index) => index);

export function PodcastLoading() {
  const { t } = useTranslation();

  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">
        {t('common.loading')}
      </span>
      <div className={podcastStyles.header} aria-hidden="true">
        <div className={podcastStyles.hero}>
          <div className={podcastStyles.artwork}>
            <div className={styles.artwork} />
          </div>
          <div className={podcastStyles.meta}>
            <div className={podcastStyles.eyebrow}>
              <span className={`${styles.bar} ${styles.eyebrow}`} />
            </div>
            <div className={podcastStyles.title}>
              <span className={`${styles.bar} ${styles.title}`} />
            </div>
            <div className={podcastStyles.author}>
              <span className={`${styles.bar} ${styles.author}`} />
            </div>
            <div className={podcastStyles.actions}>
              <span className={styles.button} />
              <span className={styles.button} />
              <span className={`${styles.button} ${styles.square}`} />
            </div>
          </div>
          <div className={podcastStyles.about}>
            <div className={podcastStyles.description}>
              {rows(5).map((index) => (
                <span className={styles.bar} key={index} />
              ))}
              <span className={`${styles.bar} ${styles.short}`} />
            </div>
            <div className={podcastStyles.facts}>
              <span className={`${styles.bar} ${styles.fact}`} />
              <span className={`${styles.bar} ${styles.fact}`} />
              <span className={`${styles.bar} ${styles.fact}`} />
            </div>
          </div>
        </div>
      </div>
      <div className={podcastStyles.body} aria-hidden="true">
        <div className={listStyles.episodes}>
          <div className={listStyles.head}>
            <div className={listStyles.heading}>
              <span className={`${styles.bar} ${styles.heading}`} />
            </div>
            <div className={listStyles.controls}>
              <span className={`${listStyles.search} ${styles.field}`} />
              <span className={`${listStyles.control} ${styles.control}`} />
            </div>
          </div>
          <ul>
            {rows(6).map((index) => (
              <li className={rowStyles.row} key={index}>
                <div className={rowStyles.date}>
                  <span className={rowStyles.month}>
                    <span className={`${styles.bar} ${styles.month}`} />
                  </span>
                  <span className={rowStyles.day}>
                    <span className={`${styles.bar} ${styles.day}`} />
                  </span>
                </div>
                <div className={rowStyles.text}>
                  <div className={rowStyles.title}>
                    <span className={`${styles.bar} ${styles.short}`} />
                  </div>
                  <div className={rowStyles.summary}>
                    <span className={styles.bar} />
                  </div>
                </div>
                <div className={rowStyles.status}>
                  <span className={`${styles.bar} ${styles.duration}`} />
                </div>
                <div className={rowStyles.actions}>
                  <span className={styles.star} />
                  <span className={rowStyles.queue} />
                  <span className={`${rowStyles.play} ${styles.fill}`} />
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className={relatedStyles.related}>
          <div className={relatedStyles.eyebrow}>
            <span className={`${styles.bar} ${styles.eyebrow}`} />
          </div>
          <ul>
            {rows(4).map((index) => (
              <li className={relatedStyles.row} key={index}>
                <span className={styles.thumb} />
                <span className={`${relatedStyles.text} ${styles.grow}`}>
                  <span className={relatedStyles.title}>
                    <span className={`${styles.bar} ${styles.short}`} />
                  </span>
                  <span className={relatedStyles.author}>
                    <span className={`${styles.bar} ${styles.author}`} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function PodcastsLoading() {
  const { t } = useTranslation();

  return (
    <section className={gridStyles.container} aria-busy="true">
      <span className="sr-only" role="status">
        {t('common.loading')}
      </span>
      <div className={gridStyles.sectionHeader}>
        <div
          className={`${styles.line} ${styles.sectionTitle}`}
          aria-hidden="true"
        />
      </div>
      <div className={gridStyles.grid} aria-hidden="true">
        {rows(10).map((index) => (
          <div className={styles.tile} key={index}>
            <div className={styles.cover} />
            <div className={styles.line} />
          </div>
        ))}
      </div>
    </section>
  );
}
