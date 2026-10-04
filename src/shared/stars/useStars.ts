'use client';

import { useEffect } from 'react';
import { create } from 'zustand';
import { useAccountSession } from '@/shared/auth/AccountBoundary';
import { getValue, type IStarredEpisode, setValue } from '@/shared/storage/idb';
import type { IEpisodeInfo } from '@/types';

const GUEST_SCOPE = 'guest';
let persistQueue = Promise.resolve();

const scopeKey = (scope: string | null) => scope ?? GUEST_SCOPE;
const identity = (episode: IEpisodeInfo) =>
  `${episode.feed}\u001f${episode.guid}`;

export type StarsState = {
  scope: string | null;
  initialized: boolean;
  stars: IStarredEpisode[];
  initialize: (scope: string | null) => Promise<void>;
  star: (episode: IEpisodeInfo) => void;
  unstar: (episode: IEpisodeInfo) => void;
  toggle: (episode: IEpisodeInfo) => void;
  contains: (episode: IEpisodeInfo) => boolean;
};

const persist = (scope: string | null, stars: IStarredEpisode[]) => {
  persistQueue = persistQueue.then(async () => {
    const all = (await getValue('stars')) ?? {};
    all[scopeKey(scope)] = stars;
    await setValue('stars', all);
  });
};

export const useStarsStore = create<StarsState>((set, get) => ({
  scope: null,
  initialized: false,
  stars: [],
  initialize: async (scope) => {
    if (get().scope === scope && get().initialized) return;
    set({ scope, initialized: false, stars: [] });
    const all = await getValue('stars');
    if (get().scope !== scope) return;
    set({ initialized: true, stars: all?.[scopeKey(scope)] ?? [] });
  },
  star: (episode) => {
    const state = get();
    const key = identity(episode);
    const index = state.stars.findIndex(
      (star) => identity(star.episode) === key,
    );
    const stars = [...state.stars];
    if (index >= 0) {
      stars[index] = { ...stars[index], episode };
    } else {
      stars.unshift({ episode, starredAt: Date.now() });
    }
    set({ stars });
    persist(state.scope, stars);
  },
  unstar: (episode) => {
    const state = get();
    const key = identity(episode);
    const stars = state.stars.filter((star) => identity(star.episode) !== key);
    if (stars.length === state.stars.length) return;
    set({ stars });
    persist(state.scope, stars);
  },
  toggle: (episode) => {
    if (get().contains(episode)) get().unstar(episode);
    else get().star(episode);
  },
  contains: (episode) =>
    get().stars.some((star) => identity(star.episode) === identity(episode)),
}));

export function useStars() {
  const session = useAccountSession();
  const scope = session.scope;
  const state = useStarsStore();

  useEffect(() => {
    void state.initialize(scope);
  }, [scope, state.initialize]);

  return {
    ...state,
    episodes: state.stars.map(({ episode }) => episode),
  };
}
