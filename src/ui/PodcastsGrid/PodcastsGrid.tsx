import * as React from 'react';
import { RenderablePodcast } from '../../types';
import { PodcastTile } from '../PodcastTile';

import styles from './PodcastsGrid.module.css';

type PodcastsGridProps = {
  podcasts: RenderablePodcast[];
};

export function PodcastsGrid({ podcasts }: PodcastsGridProps) {
  return (
    <div className={styles.grid}>
      {podcasts.map((podcast) => (
        <PodcastTile key={podcast.feed} podcast={podcast} />
      ))}
    </div>
  );
}
