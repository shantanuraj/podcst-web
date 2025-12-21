import type { Metadata } from 'next';
import { top } from '@/app/api/top/top';
import { PodcastsGrid } from '@/ui/PodcastsGrid';

export const metadata: Metadata = {
  title: 'Top Podcasts',
};

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  const podcasts = await top(100, params.locale);
  return <PodcastsGrid podcasts={podcasts} />;
}
