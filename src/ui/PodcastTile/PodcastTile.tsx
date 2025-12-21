import Link from 'next/link';
import type { RenderablePodcast } from '@/types';

import styles from './PodcastTile.module.css';

type PodcastTileProps = {
  podcast: RenderablePodcast;
};

export function PodcastTile({ podcast }: PodcastTileProps) {
  const { author, cover, feed, title } = podcast;

  return (
    <Link href={`/episodes/${encodeURIComponent(feed)}`} className={styles.tile}>
      <div className={styles.artwork}>
        <img src={cover} alt="" loading="lazy" />
      </div>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.author}>{author}</p>
    </Link>
  );
}
