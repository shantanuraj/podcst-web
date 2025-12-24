import Link from 'next/link';
import type { RenderablePodcast } from '@/types';
import { getPodcastHref } from '@/shared/links';

import styles from './PodcastTile.module.css';

type PodcastTileProps = {
  podcast: RenderablePodcast;
};

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
