'use client';

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { PodcastEpisodeSchema, PodcastSeriesSchema } from '@/components/Schema';
import { usePodcast } from '@/data/feed';
import type { IPodcastEpisodesInfo } from '@/types';
import { EpisodeInfo } from '@/ui/EpisodeInfo/EpisodeInfo';
import { EpisodesList } from '@/ui/EpisodesList';
import { Loading } from '@/ui/Loading';
import { PodcastInfo } from '@/ui/PodcastInfo/PodcastInfo';

interface EpisodesSpaClientProps {
  podcastId: number;
  initialEpisodeId: number | null;
  initialData: IPodcastEpisodesInfo | null;
}

function isNumeric(str: string): boolean {
  return /^\d+$/.test(str);
}

function parsePathname(pathname: string): { episodeId: number | null } {
  const parts = pathname.split('/').filter(Boolean);

  if (parts[0] !== 'episodes' || parts.length < 3) {
    return { episodeId: null };
  }

  const episodeSlug = parts[2];
  if (isNumeric(episodeSlug)) {
    return { episodeId: parseInt(episodeSlug, 10) };
  }

  return { episodeId: null };
}

export function EpisodesSpaClient({
  podcastId,
  initialEpisodeId: _initialEpisodeId,
  initialData,
}: EpisodesSpaClientProps) {
  const pathname = usePathname();

  const { episodeId: currentEpisodeId } = useMemo(
    () => parsePathname(pathname),
    [pathname],
  );

  const { data: info } = usePodcast(podcastId, initialData);
  const feedData = info ?? initialData;

  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://www.podcst.app';
  const currentUrl = `${origin}${pathname}`;

  if (!feedData) {
    return <Loading />;
  }

  if (currentEpisodeId) {
    const episode = feedData.episodes.find((ep) => ep.id === currentEpisodeId);

    if (!episode) {
      return <div>Episode not found</div>;
    }

    return (
      <>
        <PodcastEpisodeSchema
          podcast={feedData}
          episode={episode}
          url={currentUrl}
        />
        <EpisodeInfo podcast={feedData} episode={episode} />
      </>
    );
  }

  return (
    <>
      <PodcastSeriesSchema podcast={feedData} url={currentUrl} />
      <EpisodesList episodes={feedData.episodes} podcast={feedData}>
        <PodcastInfo info={feedData} />
      </EpisodesList>
    </>
  );
}
