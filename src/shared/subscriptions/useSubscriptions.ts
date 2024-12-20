import { create } from 'zustand';
import { fetchEpisodesInfo } from '@/data/episodes';

import { IPodcastEpisodesInfo, ISubscriptionsMap } from '@/types';
import { getValue, setValue } from '@/shared/storage/idb';
import {
  getValue as getLocalStorageValue,
  setValue as setLocalStorageValue,
} from '@/shared/storage/local';

export type SubscriptionsState = {
  subs: ISubscriptionsMap;
  init: () => Promise<void>;
  addSubscription: (feed: string, info: IPodcastEpisodesInfo) => void;
  removeSubscription: (feed: string) => void;
  toggleSubscription: (feed: string, info: IPodcastEpisodesInfo) => void;
  addSubscriptions: (podcasts: IPodcastEpisodesInfo[]) => void;
  syncSubscription: (feed: string, info: IPodcastEpisodesInfo) => void;
  isSyncing: boolean;
  syncAllSubscriptions: () => void;
};

// 1 hour in milliseconds
const CACHE_STALE_DELTA = 60 * 60 * 1000;
const isCacheStale = (lastSyncTime: number) => Date.now() - lastSyncTime > CACHE_STALE_DELTA;

const getLastSyncTime = () => getLocalStorageValue('lastSyncTime', 0);
const updateLastSyncTime = () => setLocalStorageValue('lastSyncTime', Date.now());

export const isSubscribed = (feed: string) => (state: SubscriptionsState) => !!state.subs[feed];

const emptySubs: ISubscriptionsMap = {};

export const useSubscriptions = create<SubscriptionsState>((set, get) => ({
  subs: emptySubs,
  init: async () => {
    const subscriptions = await getValue('subscriptions');
    if (subscriptions) {
      set({ subs: subscriptions });
    }
  },
  addSubscription: (feed: string, info: IPodcastEpisodesInfo) => {
    set({ subs: { ...get().subs, [feed]: info } });
  },
  removeSubscription: (feed: string) => {
    set({
      subs: Object.fromEntries(
        Object.entries(get().subs).filter(([subbedFeed]) => subbedFeed !== feed),
      ),
    });
  },
  toggleSubscription: (feed: string, info: IPodcastEpisodesInfo) => {
    const state = get();
    if (isSubscribed(feed)(state)) {
      state.removeSubscription(feed);
    } else {
      state.addSubscription(feed, info);
    }
  },
  addSubscriptions: (podcasts: IPodcastEpisodesInfo[]) => {
    const nextSubscriptions: SubscriptionsState['subs'] = {};
    podcasts.forEach((info) => {
      nextSubscriptions[info.feed] = info;
    });
    set({ subs: nextSubscriptions });
  },
  syncSubscription: (feed, info) => {
    const state = get();
    if (isSubscribed(feed)(state)) {
      state.addSubscription(feed, info);
    }
  },
  isSyncing: false,
  syncAllSubscriptions: async () => {
    const lastSyncTime = getLastSyncTime();
    if (!isCacheStale(lastSyncTime)) return;

    set({ isSyncing: true });

    const feeds = Object.keys(get().subs);

    for (const feed of feeds) {
      await fetchEpisodesInfo(feed).catch((err) => {
        console.error('Error fetching feed', feed, err);

        // Wait a second in likely case of rate-limit from iTunes
        return new Promise((resolve) => setTimeout(resolve, 1000));
      });
    }

    set({ isSyncing: false });
    updateLastSyncTime();
  },
}));

useSubscriptions.subscribe(({ subs }) => {
  // Sync subscriptions to storage
  setValue('subscriptions', subs);
});

export const getInit = (state: SubscriptionsState) => state.init;
