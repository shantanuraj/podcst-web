'use client';

import { useTranslation } from '@/shared/i18n';
import podcastStyles from '@/ui/PodcastInfo/PodcastInfo.module.css';
import gridStyles from '@/ui/PodcastsGrid/PodcastsGrid.module.css';
import styles from './PageLoading.module.css';

export function PodcastLoading() {
  const { t } = useTranslation();

  return (
    <section className={podcastStyles.header} aria-busy="true">
      <div className={podcastStyles.top}>
        <div
          className={`${podcastStyles.artwork} ${styles.placeholder}`}
          aria-hidden="true"
        />
        <div className={podcastStyles.meta}>
          <p className={podcastStyles.title} role="status">
            {t('common.loading')}
          </p>
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
      <div className={gridStyles.sectionHeader}>
        <p className={gridStyles.sectionTitle} role="status">
          {t('common.loading')}
        </p>
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
