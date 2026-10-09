'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError } from '@/data/api';
import { feedRefreshOptions } from '@/data/feed-refresh';
import { useAccountSession } from '@/shared/auth/AccountBoundary';
import { type FeedFreshness, feedRecheckDelay } from '@/shared/feed-contract';

export function FeedRefresh({
  podcastId,
  empty = false,
  initialFreshness,
}: {
  podcastId: string;
  empty?: boolean;
  initialFreshness?: FeedFreshness;
}) {
  const router = useRouter();
  const session = useAccountSession();
  const [attempt, retry] = useState(Date.now);
  const [now, tick] = useState(Date.now);
  const query = useQuery(
    feedRefreshOptions(
      session,
      podcastId,
      () => router.refresh(),
      empty,
      attempt,
    ),
  );
  const freshness = query.data?.freshness ?? initialFreshness;
  const retryAt =
    freshness?.retryAtMs ??
    (query.error instanceof ApiError && query.error.retryAfter
      ? query.errorUpdatedAt + query.error.retryAfter * 1000
      : 0);
  useEffect(() => {
    if (retryAt <= now) return;
    const timer = setTimeout(
      () => tick(Date.now()),
      Math.min(120_000, Math.max(1000, retryAt - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [retryAt, now]);
  if (freshness?.state === 'fresh' && freshness.content === 'cached')
    return null;
  if (!empty && query.isPending) return null;
  const automatic =
    query.data &&
    feedRecheckDelay(freshness, query.data.startedAt, now) !== false;
  return (
    <div role="status" aria-live="polite">
      <p>
        {freshness?.state === 'pending'
          ? freshness.content === 'missing'
            ? 'Preparing episodes…'
            : 'Refreshing episodes. Cached episodes remain available.'
          : freshness?.state === 'backoff'
            ? 'Updates delayed. Cached episodes remain available.'
            : query.isPending
              ? 'Checking episodes…'
              : 'Updates unavailable. Existing content and follows are retained.'}
      </p>
      {!automatic && !query.isFetching && (
        <button
          type="button"
          disabled={retryAt > now}
          onClick={() => retry(Date.now())}
        >
          Retry
        </button>
      )}
    </div>
  );
}
