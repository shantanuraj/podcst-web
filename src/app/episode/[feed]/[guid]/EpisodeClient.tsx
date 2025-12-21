'use client';

import { useFeed } from '@/data/feed';
import { IPodcastEpisodesInfo } from '@/types';
import { EpisodeInfo } from '@/ui/EpisodeInfo/EpisodeInfo';
import { Loading } from '@/ui/Loading';

interface EpisodeClientProps {
  feedUrl: string;
  guid: string;
  initialData: IPodcastEpisodesInfo | null;
}

export function EpisodeClient({ feedUrl, guid, initialData }: EpisodeClientProps) {
  const { data: info } = useFeed(feedUrl);
  const feedData = info ?? initialData;

  if (!feedData) return <Loading />;

  const episode = feedData.episodes.find((ep) => ep.guid === guid);

  if (!episode) {
    return <div>Episode not found</div>;
  }

  return <EpisodeInfo podcast={feedData} episode={episode} />;
}
