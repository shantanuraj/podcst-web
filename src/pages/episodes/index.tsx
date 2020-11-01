import { useRouter } from 'next/router';
import * as React from 'react';
import { useEpisodesInfo } from '../../data/episodes';
import { Loading } from '../../ui/Loading';
import { EpisodesList } from '../../ui/EpisodesList';
import { PodcastInfo } from '../../ui/PodcastInfo/PodcastInfo';
import { SubscriptionsProvider } from '../../shared/subscriptions';

export default function EpisodesPage() {
  const router = useRouter();
  const feed = router.query.feed;
  return feed && typeof feed === 'string' ? (
    <React.Suspense fallback={<Loading />}>
      <Episodes feed={feed} />
    </React.Suspense>
  ) : (
    <Loading />
  );
}

type EpisodesProps = {
  feed: string;
};

export function Episodes({ feed }: EpisodesProps) {
  const { data: info } = useEpisodesInfo(feed);
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
}
