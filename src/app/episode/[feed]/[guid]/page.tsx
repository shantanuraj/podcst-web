import { Metadata } from 'next';

import { feed } from '@/app/api/feed/feed';
import { patchEpisodesResponse } from '@/data/episodes';
import { EpisodeClient } from './EpisodeClient';

const fetchFeed = feed;

export async function generateMetadata(props: {
  params: Promise<{ feed: string; guid: string }>;
}): Promise<Partial<Metadata>> {
  const params = await props.params;
  const feedUrl = decodeURIComponent(params.feed);
  const guid = decodeURIComponent(params.guid);

  const info = feedUrl ? await fetchFeed(feedUrl) : null;
  if (!info) return {};

  const episode = info.episodes.find((ep) => ep.guid === guid);
  if (!episode) return {};

  return {
    title: episode.title,
    description: episode.summary || `Listen to ${episode.title} from ${info.title}`,
    openGraph: { images: info.cover },
  };
}

export default async function Page(props: {
  params: Promise<{ feed: string; guid: string }>;
}) {
  const params = await props.params;
  const feedUrl = decodeURIComponent(params.feed);
  const guid = decodeURIComponent(params.guid);

  const info = feedUrl ? await fetchFeed(feedUrl) : null;
  const data = patchEpisodesResponse(feedUrl)(info);

  return <EpisodeClient feedUrl={feedUrl} guid={guid} initialData={data} />;
}
