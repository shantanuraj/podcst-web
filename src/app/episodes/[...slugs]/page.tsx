import type { Metadata } from 'next';

import { feed } from '@/app/api/feed/feed';
import { patchEpisodesResponse } from '@/data/episodes';
import { EpisodesSpaClient } from './EpisodesSpaClient';

const fetchFeed = feed;

/**
 * Parse slugs to extract feed URL and optional guid
 * Expected formats:
 * - [encodedFeed] -> { feed, guid: null }
 * - [encodedFeed, encodedGuid] -> { feed, guid }
 */
function parseSlugs(slugs: string[]): { feed: string; guid: string | null } {
  const feedUrl = decodeURIComponent(slugs[0] || '');
  const guid = slugs.length >= 2 ? decodeURIComponent(slugs[1]) : null;
  return { feed: feedUrl, guid };
}

export async function generateMetadata(props: {
  params: Promise<{ slugs: string[] }>;
}): Promise<Partial<Metadata>> {
  const params = await props.params;
  const { feed: feedUrl, guid } = parseSlugs(params.slugs);

  const info = feedUrl ? await fetchFeed(feedUrl) : null;
  if (!info) return {};

  // If viewing a specific episode, use episode metadata
  if (guid) {
    const episode = info.episodes.find((ep) => ep.guid === guid);
    if (episode) {
      return {
        title: episode.title,
        description: episode.summary || `Listen to ${episode.title} from ${info.title}`,
        openGraph: { images: info.cover },
      };
    }
  }

  // Otherwise use podcast metadata
  return {
    title: info.title,
    description: info.description,
    openGraph: { images: info.cover },
  };
}

export default async function Page(props: { params: Promise<{ slugs: string[] }> }) {
  const params = await props.params;
  const { feed: feedUrl, guid } = parseSlugs(params.slugs);

  const info = feedUrl ? await fetchFeed(feedUrl) : null;
  const data = patchEpisodesResponse(feedUrl)(info);

  return <EpisodesSpaClient feedUrl={feedUrl} initialGuid={guid} initialData={data} />;
}
