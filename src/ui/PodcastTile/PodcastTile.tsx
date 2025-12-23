import Link from 'next/link';
import type { RenderablePodcast, IPodcastEpisodesInfo } from '@/types';

import styles from './PodcastTile.module.css';

type PodcastTileProps = {
  podcast: RenderablePodcast;
};

function getPodcastHref(podcast: RenderablePodcast): string {
  if (podcast.id) {
    return `/episodes/${podcast.id}`;
  }
  return `/episodes/${encodeURIComponent(podcast.feed)}`;
}

export function PodcastTile({ podcast }: PodcastTileProps) {
  const { author, cover, title } = podcast;

  return (
    <Link href={getPodcastHref(podcast)} className={styles.tile}>
      <div className={styles.artwork}>
        <img src={cover || undefined} alt="" loading="lazy" />
      </div>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.author}>{author}</p>
    </Link>
  );
}
