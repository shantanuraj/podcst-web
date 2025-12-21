import { Metadata } from 'next';

import { feed } from '@/app/api/feed/feed';
import { patchEpisodesResponse } from '@/data/episodes';
import { EpisodesClient } from './EpisodesClient';

const fetchFeed = feed;

export async function generateMetadata(props: {
  params: Promise<{ feed: string }>;
}): Promise<Partial<Metadata>> {
  const params = await props.params;
  const feedUrl = decodeURIComponent(params.feed);
  const info = feedUrl ? await fetchFeed(feedUrl) : null;
  if (!info) return {};
  return {
    title: info.title,
    description: info.description,
    openGraph: { images: info.cover },
  };
}

export default async function Page(props: { params: Promise<{ feed: string }> }) {
  const params = await props.params;
  const feedUrl = decodeURIComponent(params.feed);
  const info = feedUrl ? await fetchFeed(feedUrl) : null;
  const data = patchEpisodesResponse(feedUrl)(info);
  return <EpisodesClient feedUrl={feedUrl} initialData={data} />;
}
