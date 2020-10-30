import * as React from 'react';
import { RenderablePodcast } from '../../types';
import { PodcastTile } from '../PodcastTile';

import styles from './PodcastGrid.module.css';

type PodcastGridProps = {
  podcasts: RenderablePodcast[];
};

export function PodcastGrid({ podcasts }: PodcastGridProps) {
  return (
    <div className={styles.grid}>
      {podcasts.map((podcast) => (
        <PodcastTile key={podcast.feed} podcast={podcast} />
      ))}
    </div>
  );
}
