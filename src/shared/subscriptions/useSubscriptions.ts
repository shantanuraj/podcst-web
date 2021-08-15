import create from 'zustand';

import { IPodcastEpisodesInfo } from '../../types';
import { getValue, setValue } from '../storage/storage';

export type SubscriptionsState = {
  subs: { [feed: string]: IPodcastEpisodesInfo };
  addSubscription: (feed: string, info: IPodcastEpisodesInfo) => void;
  removeSubscription: (feed: string) => void;
  toggleSubscription: (feed: string, info: IPodcastEpisodesInfo) => void;
  addSubscriptions: (podcasts: IPodcastEpisodesInfo[]) => void;
};

export const isSubscribed = (feed: string) => (state: SubscriptionsState) => !!state.subs[feed];

export const useSubscriptions = create<SubscriptionsState>((set, get) => ({
  subs: getValue('subscriptions', {}),
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
}));

useSubscriptions.subscribe(({ subs }) => {
  // Sync subscriptions to storage
  setValue('subscriptions', subs);
});
