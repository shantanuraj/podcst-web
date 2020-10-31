import { useRouter } from 'next/router';
import * as React from 'react';
import { useEpisodesInfo } from '../../data/episodes';
import { Loading } from '../../ui/Loading';

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
      {episodes.map((ep, idx) => (
        <div key={`${idx}-${ep.title}`}>{ep.title}</div>
      ))}
    </React.Fragment>
  );
}
