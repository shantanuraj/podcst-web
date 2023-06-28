import * as React from 'react';
import { Metadata } from 'next';

import { fetchEpisodesInfo } from '../../../../data/episodes';
import { IPodcastEpisodesInfo } from '../../../../types';
import { EpisodeInfo } from '../../../../ui/EpisodeInfo/EpisodeInfo';
import { Loading } from '../../../../ui/Loading';

interface EpisodePageProps {
  feed: string;
  guid: string;
  info: IPodcastEpisodesInfo | null;
}

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

export async function generateMetadata({
  params,
}: {
  params: { feed: string; guid: string };
}): Promise<Partial<Metadata>> {
  const feed = decodeURIComponent(params.feed);
  const guid = decodeURIComponent(params.guid);
  const guidParam = guid;

  const info = typeof feed === 'string' && feed ? await fetchEpisodesInfo(feed) : null;
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

export default async function Page({
  params,
}: {
  params: {
    feed: string;
    guid: string;
  };
}) {
  const feed = decodeURIComponent(params.feed);
  const guid = decodeURIComponent(params.guid);

  const info = typeof feed === 'string' && feed ? await fetchEpisodesInfo(feed) : null;

  return <Episode feed={feed} guid={guid} info={info} />;
}
