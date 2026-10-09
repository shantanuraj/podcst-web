'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAccountSession } from '@/shared/auth/AccountBoundary';
import { feedRecheckDelay } from '@/shared/feed-contract';
import type { IEpisodeInfo } from '@/types';
import { starRuntime } from './browser';
import { project, validEpisodeId } from './state';

export function useStars() {
  const session = useAccountSession();
  const { sync } = starRuntime(session);
  const token = session.token();
  const view = useSyncExternalStore(
    sync.subscribe,
    sync.getSnapshot,
    sync.getSnapshot,
  );
  const state =
    session.getSnapshot().ready && session.scope === view.scope
      ? view.state
      : undefined;
  const stars = state ? project(state) : [];
  const window = useMemo(() => ({ startedAt: Date.now() }), [token]);
  const delays = stars.flatMap((item) => {
    const delay = feedRecheckDelay(
      item.freshness ?? undefined,
      window.startedAt,
    );
    return delay === false ? [] : [delay];
  });
  const delay = delays.length ? Math.min(...delays) : false;
  useEffect(() => {
    if (
      delay === false ||
      document.visibilityState === 'hidden' ||
      !session.current(token)
    )
      return;
    const timer = setTimeout(() => {
      if (session.current(token) && document.visibilityState !== 'hidden')
        void sync.refresh();
    }, delay);
    return () => clearTimeout(timer);
  }, [delay, session, token, sync]);
  return {
    stars,
    episodes: stars.flatMap(({ episode }) => (episode ? [episode] : [])),
    initialized: !!state,
    pending:
      !!state &&
      view.scope !== null &&
      (!!state.flight || state.queued.length > 0),
    error:
      state?.blocked || state?.unresolved?.length
        ? 'Star sync needs attention. Pending edits have been kept.'
        : state?.failures.length
          ? `${state.failures.length} episode(s) could not be added.`
          : view.error,
    contains: (episode: IEpisodeInfo) =>
      validEpisodeId(episode.id) &&
      stars.some(({ episodeId }) => episodeId === episode.id),
    toggle: (episode: IEpisodeInfo) => {
      if (state && session.current(token) && validEpisodeId(episode.id))
        void sync.edit(episode.id, undefined, episode).catch(() => {});
    },
    unstar: (episodeId: string) => {
      if (state && session.current(token))
        void sync.edit(episodeId, 'remove').catch(() => {});
    },
    refresh: () => {
      window.startedAt = Date.now();
      return sync.refresh();
    },
  };
}
