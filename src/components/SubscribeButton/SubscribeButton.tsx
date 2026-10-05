'use client';

import { useCallback, useMemo } from 'react';
import { useSession } from '@/shared/auth/useAuth';
import { useTranslation } from '@/shared/i18n';
import {
  useServerSubscriptions,
  useSubscribe,
  useUnsubscribe,
} from '@/shared/subscriptions/useServerSubscriptions';
import {
  isSubscribed,
  useSubscriptions,
} from '@/shared/subscriptions/useSubscriptions';
import type { IPodcastEpisodesInfo } from '@/types';
import { Button } from '@/ui/Button';

export function SubscribeButton({ info }: { info: IPodcastEpisodesInfo }) {
  const { t } = useTranslation();
  const { data: user } = useSession();
  const { data: serverSubs } = useServerSubscriptions();
  const { mutate: serverSubscribe, isPending: isSubscribing } = useSubscribe();
  const { mutate: serverUnsubscribe, isPending: isUnsubscribing } =
    useUnsubscribe();

  const feed = info.feed;
  const podcastId = info.id;
  const isLocalSubscribed = useSubscriptions(
    useCallback(isSubscribed(feed), [feed]),
  );
  const addSubscription = useSubscriptions((state) => state.addSubscription);
  const removeSubscription = useSubscriptions(
    (state) => state.removeSubscription,
  );

  const isServerSubscribed = useMemo(
    () => serverSubs?.some((sub) => sub.id === podcastId) ?? false,
    [serverSubs, podcastId],
  );

  const canUseServer = user && podcastId;
  const isSubscribedToFeed = canUseServer
    ? isServerSubscribed
    : isLocalSubscribed;
  const isPending = isSubscribing || isUnsubscribing;

  const onSubscribeClick = useCallback(() => {
    if (canUseServer) {
      if (isServerSubscribed) {
        serverUnsubscribe(podcastId);
      } else {
        serverSubscribe(podcastId);
      }
    } else {
      if (info.isPrivate) return;
      if (isLocalSubscribed) {
        removeSubscription(feed);
      } else {
        addSubscription(feed, info);
      }
    }
  }, [
    canUseServer,
    isServerSubscribed,
    isLocalSubscribed,
    podcastId,
    feed,
    info,
    addSubscription,
    removeSubscription,
    serverSubscribe,
    serverUnsubscribe,
  ]);

  return (
    <Button
      data-is-subscribed={isSubscribedToFeed}
      data-variant={isSubscribedToFeed ? undefined : 'primary'}
      onClick={onSubscribeClick}
      disabled={isPending || (!!info.isPrivate && !canUseServer)}
      suppressHydrationWarning
    >
      {isSubscribedToFeed ? t('podcast.unsubscribe') : t('podcast.subscribe')}
    </Button>
  );
}
