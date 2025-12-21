import type { Metadata } from 'next';
import { top } from '@/app/api/top/top';
import { PodcastsGrid } from '@/ui/PodcastsGrid';

export const metadata: Metadata = {
  title: 'Top Podcasts',
};

export default async function Page() {
  const podcasts = await top(100);
  return <PodcastsGrid podcasts={podcasts} />;
}
