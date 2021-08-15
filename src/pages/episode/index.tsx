import { GetServerSideProps, NextPage } from 'next';
import * as React from 'react';

import { fetchEpisodesInfo, useEpisodesInfo } from '../../data/episodes';
import { Loading } from '../../ui/Loading';
import { IPodcastEpisodesInfo } from '../../types';
import { EpisodeInfo } from '../../ui/EpisodeInfo/EpisodeInfo';

type EpisodePageProps = {
  feed: string;
  guid: string;
  info: IPodcastEpisodesInfo | null;
};

const EpisodePage: NextPage<EpisodePageProps> = (props) => {
  const { data: info } = useEpisodesInfo(props.feed, props.info);
  if (!info) return <Loading />;

  const { episodes } = info;
  const episode = episodes.find(({ guid }) => guid === props.guid);

  if (!episode) {
    return <div>Couldn't get Podcasts episode</div>;
  }

  return <EpisodeInfo podcast={info} episode={episode} />;
};

export const getServerSideProps: GetServerSideProps<EpisodePageProps> = async (ctx) => {
  const { feed, guid } = ctx.query;
  const info = typeof feed === 'string' ? await fetchEpisodesInfo(feed) : null;
  return {
    props: {
      feed: typeof feed === 'string' ? feed : '',
      guid: typeof guid === 'string' ? guid : '',
      info,
    },
  };
};

export default EpisodePage;
