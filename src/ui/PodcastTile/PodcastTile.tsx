import Link from 'next/link';
import * as React from 'react';
import { RenderablePodcast } from '../../types';

import styles from './PodcastTile.module.css';

type PodcastTileProps = {
  podcast: RenderablePodcast;
};

export function PodcastTile({ podcast }: PodcastTileProps) {
  const { author, cover, feed, title } = podcast;
  return (
    <Link href={`/episodes?feed=${feed}`}>
      <a className={styles.wrapper}>
        <div role="img" aria-label={`${title} by ${author}`} className={styles.tile}>
          <div>
            <div className={styles.title}>{title}</div>
            <div className={styles.author}>{author}</div>
          </div>
        </div>
        <style jsx>{`
          .${styles.tile} {
            background: linear-gradient(
                to bottom,
                rgba(0, 0, 0, 0) 0%,
                rgba(0, 0, 0, 0) 12%,
                rgba(0, 0, 0, 0) 23%,
                rgba(0, 0, 0, 0) 34%,
                rgba(0, 0, 0, 0) 50%,
                rgba(0, 0, 0, 0.2) 60%,
                rgba(0, 0, 0, 0.4) 76%,
                rgba(17, 17, 17, 0.5) 88%,
                rgba(28, 28, 28, 0.5) 94%,
                rgba(43, 43, 43, 0.6) 95%,
                rgba(19, 19, 19, 0.8) 100%
              ),
              no-repeat url(${cover});
            background-size: cover;
          }
        `}</style>
      </a>
    </Link>
  );
}