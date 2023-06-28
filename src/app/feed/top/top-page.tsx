import Head from 'next/head';
import * as React from 'react';

import { IPodcast } from '../../../types';
import { Loading } from '../../../ui/Loading';
import { PodcastsGrid } from '../../../ui/PodcastsGrid';

export function Feed({ podcasts }: { podcasts: IPodcast[] }) {
  if (!podcasts || !podcasts.length) return <Loading />;

  return (
    <React.Fragment>
      <Head>
        <title>Podcst | Top Podcasts</title>
      </Head>
      <PodcastsGrid podcasts={podcasts} />
    </React.Fragment>
  );
}
