import * as React from 'react';

import { Feed } from './top-page';
import { Metadata } from 'next';
import { top } from '../../api/top/top';

export const metadata: Metadata = {
  title: 'Top Podcasts',
};

export default async function Page() {
  const podcasts = await top(100);
  return <Feed podcasts={podcasts} />;
}
