import * as React from 'react';
import Head from 'next/head';

import { fetchFeed } from '../../data/feed';
import { FeedType, IPodcast } from '../../types';
import { Loading } from '../../ui/Loading';
import { GetStaticPaths, GetStaticProps, InferGetStaticPropsType } from 'next';
import { FEED_REVALIDATE_DURATION } from '../../data/constants';
import { PodcastGrid } from '../../ui/PodcastGrid';

export const getStaticPaths: GetStaticPaths = async () => {
  return {
    paths: [{ params: { feed: 'top' } }],
    fallback: true,
  };
};

export const getStaticProps: GetStaticProps<{ podcasts: IPodcast[] }> = async (context) => {
  const feed = isAllowedFeed(context.params?.feed) ? (context.params?.feed as FeedType) : 'top';
  return {
    props: {
      podcasts: await fetchFeed(feed),
    },
    revalidate: FEED_REVALIDATE_DURATION,
  };
};

export default function Feed({ podcasts }: InferGetStaticPropsType<typeof getStaticProps>) {
  if (!podcasts || !podcasts.length) return <Loading />;

  return (
    <React.Fragment>
      <Head>
        <title>Podcst | Top Podcasts</title>
      </Head>
      <PodcastGrid podcasts={podcasts} />
    </React.Fragment>
  );
}

const allowedFeeds = ['top'] as const;

const isAllowedFeed = (feed: string | string[] | undefined): feed is FeedType =>
  allowedFeeds.includes(feed as typeof allowedFeeds[number]);
