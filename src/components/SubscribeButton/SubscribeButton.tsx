'use client';

import { useCallback } from 'react';
import { useSubscriptions, isSubscribed } from '@/shared/subscriptions/useSubscriptions';
import { Button } from '@/ui/Button';
import { PodcastInfoProps } from '@/ui/PodcastInfo/PodcastInfo';

export function SubscribeButton({ info }: PodcastInfoProps) {
  const feed = info.feed;
  const isSubscribedToFeed = useSubscriptions(useCallback(isSubscribed(feed), [feed]));
  const toggleSubscription = useSubscriptions(
    useCallback((state) => state.toggleSubscription, [feed]),
  );
  const onSubscribeClick = useCallback(() => toggleSubscription(info.feed, info), [info]);

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
