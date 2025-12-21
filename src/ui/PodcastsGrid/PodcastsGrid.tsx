import type { RenderablePodcast } from '@/types';
import { PodcastTile } from '@/ui/PodcastTile';

import styles from './PodcastsGrid.module.css';

type PodcastsGridProps = {
  podcasts: RenderablePodcast[];
  title?: string;
};

export function PodcastsGrid({ podcasts, title = 'Trending' }: PodcastsGridProps) {
  if (!podcasts || !podcasts.length) {
    return (
      <div className={styles.container}>
        <div className={styles.section}>
          <header className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>{title}</h2>
          </header>
          <p>No podcasts found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <section className={styles.section}>
        <header className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>{title}</h2>
        </header>
        <div className={styles.grid}>
          {podcasts.map((podcast) => (
            <PodcastTile key={podcast.feed} podcast={podcast} />
          ))}
        </div>
      </section>
    </div>
  );
}
