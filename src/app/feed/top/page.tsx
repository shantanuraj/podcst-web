import * as React from 'react';

import { fetchFeed } from '../../../data/feed';
import { Feed } from './top-page';

export default async function Page() {
  const podcasts = await fetchFeed('top');
  return <Feed podcasts={podcasts} />;
}
