import { GetServerSideProps, NextPage } from 'next';
import { useRouter } from 'next/router';
import * as React from 'react';

import { fetchEpisodesInfo, useEpisodesInfo } from '../../data/episodes';
import { Loading } from '../../ui/Loading';
import { EpisodesList } from '../../ui/EpisodesList';
import { PodcastInfo } from '../../ui/PodcastInfo/PodcastInfo';
import { IPodcastEpisodesInfo } from '../../types';

type EpisodesPageProps = {
  feed: string;
  info: IPodcastEpisodesInfo | null;
};

const EpisodesPage: NextPage<EpisodesPageProps> = (props) => {
  const router = useRouter();
  const { data: info } = useEpisodesInfo(router.query.feed as string, props.info);
  if (!info) return <Loading />;

  const { episodes } = info;

  /* TODO 2021-08-15 Check why EpisodesList crashes when rendered under EpisodesInfo page on SSR when using the PlayButton in DOM */
  if (typeof window === 'undefined') return null;
  return (
    <EpisodesList episodes={episodes}>
      <PodcastInfo info={info} />
    </EpisodesList>
  );
};

export const getServerSideProps: GetServerSideProps<EpisodesPageProps> = async (ctx) => {
  const { feed } = ctx.query;
  const info = typeof feed === 'string' ? await fetchEpisodesInfo(feed) : null;
  return {
    props: {
      feed: typeof feed === 'string' ? feed : '',
      info,
    },
  };
};

export default EpisodesPage;
