import * as React from 'react';

import { IPodcast } from '../../../types';
import { Loading } from '../../../ui/Loading';
import { PodcastsGrid } from '../../../ui/PodcastsGrid';

export function Feed({ podcasts }: { podcasts: IPodcast[] }) {
  if (!podcasts || !podcasts.length) return <Loading />;

  return (
    <React.Fragment>
      <PodcastsGrid podcasts={podcasts} />
    </React.Fragment>
  );
}
