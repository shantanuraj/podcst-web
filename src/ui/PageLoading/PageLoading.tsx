'use client';

import { useTranslation } from '@/shared/i18n';
import podcastStyles from '@/ui/PodcastInfo/PodcastInfo.module.css';
import gridStyles from '@/ui/PodcastsGrid/PodcastsGrid.module.css';
import styles from './PageLoading.module.css';

export function PodcastLoading() {
  const { t } = useTranslation();

  return (
    <section className={podcastStyles.header} aria-busy="true">
      <span className="sr-only" role="status">
        {t('common.loading')}
      </span>
      <div className={podcastStyles.top}>
        <div
          className={`${podcastStyles.artwork} ${styles.placeholder}`}
          aria-hidden="true"
        />
        <div className={`${podcastStyles.meta} ${styles.meta}`}>
          <div
            className={`${styles.line} ${styles.title}`}
            aria-hidden="true"
          />
          <div className={styles.line} aria-hidden="true" />
          <div className={styles.action} aria-hidden="true" />
        </div>
      </div>
      <div className={styles.details} aria-hidden="true">
        <div className={styles.line} />
        <div className={styles.line} />
        <div className={styles.line} />
      </div>
    </section>
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
        {Array.from({ length: 10 }, (_, index) => (
          <div className={styles.tile} key={index}>
            <div className={styles.cover} />
            <div className={styles.line} />
          </div>
        ))}
      </div>
    </section>
  );
}
