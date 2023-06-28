import * as React from 'react';

import { fetchFeed } from '../../../data/feed';
import { Feed } from './top-page';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Top Podcasts',
};

export default async function Page() {
  const podcasts = await fetchFeed('top');
  return <Feed podcasts={podcasts} />;
}
