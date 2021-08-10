import { NextPage } from 'next';
import * as React from 'react';

import { fetchEpisodesInfo, useEpisodesInfo } from '../../data/episodes';
import { Loading } from '../../ui/Loading';
import { EpisodesList } from '../../ui/EpisodesList';
import { PodcastInfo } from '../../ui/PodcastInfo/PodcastInfo';
import { SubscriptionsProvider } from '../../shared/subscriptions';
import { IPodcastEpisodesInfo } from '../../types';

type EpisodesPageProps = {
  feed: string;
  info: IPodcastEpisodesInfo | null;
};

const EpisodesPage: NextPage<EpisodesPageProps> = (props) => {
  const { data: info } = useEpisodesInfo(props.feed, props.info);
  if (!info) return <Loading />;

  const { episodes } = info;

  return (
    <React.Fragment>
      <SubscriptionsProvider>
        <PodcastInfo info={info} />
      </SubscriptionsProvider>
      <EpisodesList episodes={episodes} />
    </React.Fragment>
  );
};

EpisodesPage.getInitialProps = async (ctx) => {
  const { feed } = ctx.query;
  const info = typeof feed === 'string' ? await fetchEpisodesInfo(feed) : null;
  return {
    feed: typeof feed === 'string' ? feed : '',
    info,
  };
};

export default EpisodesPage;
