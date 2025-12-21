'use client';

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

import { useFeed } from '@/data/feed';
import type { IPodcastEpisodesInfo } from '@/types';
import { EpisodeInfo } from '@/ui/EpisodeInfo/EpisodeInfo';
import { EpisodesList } from '@/ui/EpisodesList';
import { Loading } from '@/ui/Loading';
import { PodcastInfo } from '@/ui/PodcastInfo/PodcastInfo';
import { PodcastEpisodeSchema, PodcastSeriesSchema } from '@/components/Schema';

interface EpisodesSpaClientProps {
  feedUrl: string;
  initialGuid: string | null;
  initialData: IPodcastEpisodesInfo | null;
}

/**
 * Parse the current pathname to extract feed and guid
 * Expected formats:
 * - /episodes/[encodedFeed] -> { feed, guid: null }
 * - /episodes/[encodedFeed]/[encodedGuid] -> { feed, guid }
 */
function parsePathname(pathname: string): { feed: string | null; guid: string | null } {
  const parts = pathname.split('/').filter(Boolean);

  // parts[0] should be 'episodes'
  if (parts[0] !== 'episodes' || parts.length < 2) {
    return { feed: null, guid: null };
  }

  const feed = decodeURIComponent(parts[1]);
  const guid = parts.length >= 3 ? decodeURIComponent(parts[2]) : null;

  return { feed, guid };
}

export function EpisodesSpaClient({
  feedUrl,
  initialGuid: _initialGuid,
  initialData,
}: EpisodesSpaClientProps) {
  const pathname = usePathname();

  // Parse current URL to determine what to render
  const { guid: currentGuid } = useMemo(() => parsePathname(pathname), [pathname]);

  // Use the same feed hook - React Query will cache the data
  const { data: info } = useFeed(feedUrl);
  const feedData = info ?? initialData;

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://www.podcst.app';
  const currentUrl = `${origin}${pathname}`;

  if (!feedData) {
    return <Loading />;
  }

  // If we have a guid, show the episode detail view
  if (currentGuid) {
    const episode = feedData.episodes.find((ep) => ep.guid === currentGuid);

    if (!episode) {
      return <div>Episode not found</div>;
    }

    return (
      <>
        <PodcastEpisodeSchema podcast={feedData} episode={episode} url={currentUrl} />
        <EpisodeInfo podcast={feedData} episode={episode} />
      </>
    );
  }

  // Otherwise show the episodes list
  return (
    <>
      <PodcastSeriesSchema podcast={feedData} url={currentUrl} />
      <EpisodesList episodes={feedData.episodes}>
        <PodcastInfo info={feedData} />
      </EpisodesList>
    </>
  );
}
