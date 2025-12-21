'use client';

import { useFeed } from '@/data/feed';
import { IPodcastEpisodesInfo } from '@/types';
import { EpisodesList } from '@/ui/EpisodesList';
import { Loading } from '@/ui/Loading';
import { PodcastInfo } from '@/ui/PodcastInfo/PodcastInfo';

interface EpisodesClientProps {
  feedUrl: string;
  initialData: IPodcastEpisodesInfo | null;
}

export function EpisodesClient({ feedUrl, initialData }: EpisodesClientProps) {
  const { data: info } = useFeed(feedUrl);
  const feedData = info ?? initialData;

  if (!feedData) return <Loading />;

  return (
    <EpisodesList episodes={feedData.episodes}>
      <PodcastInfo info={feedData} />
    </EpisodesList>
  );
}
