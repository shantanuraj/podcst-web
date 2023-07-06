import Link from 'next/link';
import * as React from 'react';
import { RenderablePodcast } from '@/types';

import styles from './PodcastTile.module.css';
import Image from 'next/image';

type PodcastTileProps = {
  podcast: RenderablePodcast;
};

export function PodcastTile({ podcast }: PodcastTileProps) {
  const { author, cover, feed, title } = podcast;
  return (
    <Link href={`/episodes/${encodeURIComponent(feed)}`} className={styles.wrapper}>
      <div
        data-tile
        style={{
          ['--asset-tile' as any]: `url(${cover})`,
        }}
        className={styles.tile}
      >
        {/* <Image src={cover} alt={`${title} by ${author}`} height={200} width={200} /> */}
        <div>
          <div className={styles.title}>{title}</div>
          <div className={styles.author}>{author}</div>
        </div>
      </div>
    </Link>
  );
}
