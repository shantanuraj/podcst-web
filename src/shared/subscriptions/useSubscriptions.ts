import { get as readLegacy } from 'idb-keyval';
import { create } from 'zustand';
import { fetchEpisodesInfo } from '@/data/episodes';
import { browserStateStorage, convertGuestFollows } from '@/data/state-storage';
import { isCanonicalId } from '@/shared/canonical-id';
import type { IPodcastEpisodesInfo, ISubscriptionsMap } from '@/types';

export type SubscriptionsState = {
  subs: ISubscriptionsMap;
  initialized: boolean;
  error?: string;
  init: () => Promise<void>;
  addSubscription: (feed: string, info: IPodcastEpisodesInfo) => Promise<void>;
  removeSubscription: (feed: string) => Promise<void>;
  toggleSubscription: (
    feed: string,
    info: IPodcastEpisodesInfo,
  ) => Promise<void>;
  addSubscriptions: (podcasts: IPodcastEpisodesInfo[]) => Promise<void>;
  syncSubscription: (feed: string, info: IPodcastEpisodesInfo) => Promise<void>;
  isSyncing: boolean;
  syncAllSubscriptions: () => Promise<void>;
};
const storage = browserStateStorage();
export const isSubscribed = (feed: string) => (state: SubscriptionsState) =>
  !!state.subs[feed];
export const useSubscriptions = create<SubscriptionsState>((set, get) => {
  const persist = async (change: Parameters<typeof storage.update>[0]) => {
    try {
      const root = await storage.update(change);
      set({
        initialized: true,
        subs: Object.fromEntries(
          Object.entries(root.guest.catalog ?? {}).filter(
            ([, item]) => item.id && root.guest.follows.includes(item.id),
          ),
        ),
        error: undefined,
      });
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel('podcst-durable-state');
        channel.postMessage('changed');
        channel.close();
      }
    } catch (error) {
      set({
        error:
          'Guest follows could not be saved or read. Source data retained.',
      });
      throw error;
    }
  };
  return {
    subs: {},
    initialized: false,
    isSyncing: false,
    init: async () => {
      try {
        const source = await readLegacy('subscriptions');
        await persist((root) => {
          if (source !== undefined) convertGuestFollows(root, source);
        });
      } catch {
        set({
          initialized: true,
          error: 'Guest follows could not be opened. Source data retained.',
        });
      }
    },
    addSubscription: async (feed, info) => {
      if (info.isPrivate) return;
      await get().addSubscriptions([{ ...info, feed }]);
    },
    addSubscriptions: (podcasts) =>
      persist((root) => {
        root.guest.catalog ??= {};
        for (const info of podcasts) {
          if (info.isPrivate) continue;
          if (!isCanonicalId(info.id))
            throw new Error('Resolve this podcast before following');
          root.guest.catalog[info.feed] = info;
          if (!root.guest.follows.includes(info.id))
            root.guest.follows.push(info.id);
        }
      }),
    removeSubscription: (feed) =>
      persist((root) => {
        const id = root.guest.catalog?.[feed]?.id;
        root.guest.follows = root.guest.follows.filter((item) => item !== id);
        if (root.guest.catalog) delete root.guest.catalog[feed];
      }),
    toggleSubscription: (feed, info) =>
      isSubscribed(feed)(get())
        ? get().removeSubscription(feed)
        : get().addSubscription(feed, info),
    syncSubscription: (feed, info) =>
      persist((root) => {
        if (root.guest.catalog?.[feed] && !info.isPrivate)
          root.guest.catalog[feed] = info;
      }),
    syncAllSubscriptions: async () => {
      set({ isSyncing: true });
      try {
        for (const feed of Object.keys(get().subs))
          await fetchEpisodesInfo(feed);
      } catch {
        set({ error: 'Some followed podcasts could not be refreshed.' });
      } finally {
        set({ isSyncing: false });
      }
    },
  };
});
export const getInit = (state: SubscriptionsState) => state.init;
