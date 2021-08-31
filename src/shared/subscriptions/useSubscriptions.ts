import create from 'zustand';

import { IPodcastEpisodesInfo, ISubscriptionsMap } from '../../types';
import { getValue, setValue } from '../storage/idb';

export type SubscriptionsState = {
  subs: ISubscriptionsMap;
  init: () => Promise<void>;
  addSubscription: (feed: string, info: IPodcastEpisodesInfo) => void;
  removeSubscription: (feed: string) => void;
  toggleSubscription: (feed: string, info: IPodcastEpisodesInfo) => void;
  addSubscriptions: (podcasts: IPodcastEpisodesInfo[]) => void;
  syncSubscription: (feed: string, info: IPodcastEpisodesInfo) => void;
};

export const isSubscribed = (feed: string) => (state: SubscriptionsState) => !!state.subs[feed];

export const useSubscriptions = create<SubscriptionsState>((set, get) => ({
  subs: {},
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
}));

useSubscriptions.subscribe(({ subs }) => {
  // Sync subscriptions to storage
  setValue('subscriptions', subs);
});

export const getInit = (state: SubscriptionsState) => state.init;
