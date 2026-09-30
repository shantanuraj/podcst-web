import Link from 'next/link';
import { getPodcastHref } from '@/shared/links';
import type { RenderablePodcast } from '@/types';
import { ProxiedImage } from '@/ui/Image';

import styles from './PodcastTile.module.css';

type PodcastTileProps = {
  podcast: RenderablePodcast;
  priority?: boolean;
};

export function PodcastTile({ podcast, priority = false }: PodcastTileProps) {
  const { author, cover, title } = podcast;

  return (
    <Link href={getPodcastHref(podcast)} className={styles.tile}>
      <div className={styles.artwork}>
        <ProxiedImage
          src={cover || undefined}
          alt=""
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          sizes="(min-width: 1280px) 201.6px, (min-width: 1152px) 258px, (min-width: 1024px) calc((100vw - 120px) / 4), (min-width: 640px) calc((100vw - 112px) / 3), calc((100vw - 80px) / 2)"
        />
      </div>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.author}>{author}</p>
    </Link>
  );
}
