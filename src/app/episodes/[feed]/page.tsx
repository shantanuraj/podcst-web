import * as React from 'react';
import { Metadata } from 'next';

import { IPodcastEpisodesInfo } from '@/types';
import { EpisodesList } from '@/ui/EpisodesList';
import { Loading } from '@/ui/Loading';
import { PodcastInfo } from '@/ui/PodcastInfo/PodcastInfo';
import { feed } from '@/app/api/feed/feed';
import { patchEpisodesResponse } from '@/data/episodes';

interface EpisodesPageProps {
  feed: string;
  info: IPodcastEpisodesInfo | null;
}

const fetchFeed = feed;

const EpisodesPage = (props: EpisodesPageProps) => {
  const { info } = props;
  if (!info) return <Loading />;

  const { episodes } = info;

  return (
    <EpisodesList episodes={episodes}>
      <PodcastInfo info={info} />
    </EpisodesList>
  );
};

export async function generateMetadata({
  params,
}: {
  params: { feed: string };
}): Promise<Partial<Metadata>> {
  const feed = decodeURIComponent(params.feed);
  const info = typeof feed === 'string' && feed ? await fetchFeed(feed) : null;
  if (!info) return {};
  const metadata: Metadata = {
    title: info.title,
    description: info.description,
    openGraph: {
      images: info.cover,
    },
  };
  return metadata;
}

export default async function Page({ params }: { params: { feed: string } }) {
  const feed = decodeURIComponent(params.feed);
  const info = typeof feed === 'string' && feed ? await fetchFeed(feed) : null;
  const data = patchEpisodesResponse(feed)(info);
  return <EpisodesPage feed={feed} info={data} />;
}
