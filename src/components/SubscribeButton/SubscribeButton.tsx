'use client';

import { useCallback } from 'react';
import { isSubscribed, useSubscriptions } from '@/shared/subscriptions/useSubscriptions';
import { Button } from '@/ui/Button';
import type { PodcastInfoProps } from '@/ui/PodcastInfo/PodcastInfo';

export function SubscribeButton({ info }: PodcastInfoProps) {
  const feed = info.feed;
  const isSubscribedToFeed = useSubscriptions(useCallback(isSubscribed(feed), []));
  const toggleSubscription = useSubscriptions(useCallback((state) => state.toggleSubscription, []));
  const onSubscribeClick = useCallback(
    () => toggleSubscription(info.feed, info),
    [info, toggleSubscription],
  );

  return (
    <Button
      data-is-subscribed={isSubscribedToFeed}
      onClick={onSubscribeClick}
      suppressHydrationWarning
    >
      {isSubscribedToFeed ? 'Unsubscribe' : 'Subscribe'}
    </Button>
  );
}
