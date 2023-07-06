import * as React from 'react';

import { Metadata } from 'next';
import { top } from '@/app/api/top/top';
import { PodcastsGrid } from '@/ui/PodcastsGrid';

export const metadata: Metadata = {
  title: 'Top Podcasts',
};

export default async function Page({ params }: { params: { locale: string } }) {
  const podcasts = await top(100, params.locale);
  return <PodcastsGrid podcasts={podcasts} />;
}
