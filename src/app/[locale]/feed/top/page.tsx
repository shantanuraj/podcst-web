import type { Metadata } from 'next';
import { top } from '@/app/api/top/top';
import { ItemListSchema } from '@/components/Schema';
import { PodcastsGrid } from '@/ui/PodcastsGrid';

export const metadata: Metadata = {
  title: 'Top Podcasts',
};

export default async function Page(props: {
  params: Promise<{ locale: string }>;
}) {
  const params = await props.params;
  const podcasts = await top(100, params.locale);
  return (
    <>
      <ItemListSchema items={podcasts} title="Top Podcasts" />
      <PodcastsGrid podcasts={podcasts} title="Trending" />
    </>
  );
}
