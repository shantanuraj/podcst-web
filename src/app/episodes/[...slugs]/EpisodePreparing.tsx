'use client';

import { useRouter } from 'next/navigation';
import type { FeedFreshness } from '@/shared/feed-contract';
import { FeedRefresh } from './FeedRefresh';

export function EpisodePreparing({
  podcastId,
  freshness,
}: {
  podcastId: string;
  freshness: FeedFreshness;
}) {
  const router = useRouter();
  return (
    <section aria-live="polite">
      <h1>
        {freshness.state === 'pending'
          ? 'Preparing episode…'
          : 'Episode temporarily unavailable'}
      </h1>
      <p>
        The episode identity is retained. Your follows and saved items have not
        changed.
      </p>
      <FeedRefresh podcastId={podcastId} empty initialFreshness={freshness} />
      {['unavailable', 'stale'].includes(freshness.state) && (
        <button type="button" onClick={() => router.refresh()}>
          Retry episode
        </button>
      )}
    </section>
  );
}
