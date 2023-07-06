import * as React from 'react';
import { RenderablePodcast } from '@/types';
import { Loading } from '@/ui/Loading';
import { PodcastTile } from '@/ui/PodcastTile';

import styles from './PodcastsGrid.module.css';

type PodcastsGridProps = {
  podcasts: RenderablePodcast[];
};

function PodcastsGridView({ podcasts }: PodcastsGridProps) {
  return (
    <div className={styles.grid}>
      {podcasts.map((podcast) => (
        <PodcastTile key={podcast.feed} podcast={podcast} />
      ))}
    </div>
  );
}

export function PodcastsGrid({ podcasts }: { podcasts: RenderablePodcast[] }) {
  if (!podcasts || !podcasts.length) return <Loading />;
  return <PodcastsGridView podcasts={podcasts} />;
}
