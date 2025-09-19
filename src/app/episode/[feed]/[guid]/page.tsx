import * as React from 'react';
import { Metadata } from 'next';

import { patchEpisodesResponse } from '@/data/episodes';
import { IPodcastEpisodesInfo } from '@/types';
import { EpisodeInfo } from '@/ui/EpisodeInfo/EpisodeInfo';
import { Loading } from '@/ui/Loading';
import { feed } from '@/app/api/feed/feed';

interface EpisodePageProps {
  feed: string;
  guid: string;
  info: IPodcastEpisodesInfo | null;
}

const fetchFeed = feed;

const Episode = (props: EpisodePageProps) => {
  const { info } = props;
  if (!info) return <Loading />;

  const { episodes } = info;
  const episode = episodes.find(({ guid }) => guid === props.guid);

  if (!episode) {
    return <div>{`Couldn't get Podcasts episode`}</div>;
  }

  return <EpisodeInfo podcast={info} episode={episode} />;
};

export async function generateMetadata(props: {
  params: Promise<{ feed: string; guid: string }>;
}): Promise<Partial<Metadata>> {
  const params = await props.params;
  const feed = decodeURIComponent(params.feed);
  const guid = decodeURIComponent(params.guid);
  const guidParam = guid;

  const info = typeof feed === 'string' && feed ? await fetchFeed(feed) : null;
  if (!info) return {};

  const { episodes } = info;
  const episode = episodes.find(({ guid }) => guid === guidParam);
  if (!episode) return {};

  const metadata: Metadata = {
    title: episode.title,
    description: episode.summary || `Listen to ${episode.title} from ${info.title}`,
    openGraph: {
      images: info.cover,
    },
  };
  return metadata;
}

export default async function Page(props: {
  params: Promise<{
    feed: string;
    guid: string;
  }>;
}) {
  const params = await props.params;
  const feed = decodeURIComponent(params.feed);
  const guid = decodeURIComponent(params.guid);

  const info = typeof feed === 'string' && feed ? await fetchFeed(feed) : null;
  const data = patchEpisodesResponse(feed)(info);

  return <Episode feed={feed} guid={guid} info={data} />;
}
