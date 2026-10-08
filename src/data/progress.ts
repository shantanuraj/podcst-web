import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useAccountSession } from '@/shared/auth/AccountBoundary';
import { accountQueryKey } from '@/shared/auth/account';
import type { AccountSession } from '@/shared/auth/account-session';
import { compareCanonicalIds } from '@/shared/canonical-id';
import type { EpisodeProgress, IEpisodeInfo } from '@/types';
import { get } from './api';
import { stateRuntime, useDurableState } from './state-browser';

export function usePodcastProgress(podcastId: string | undefined) {
  const session = useAccountSession();
  const token = session.token();
  const resource = podcastId ?? 0;
  const options = session.query('podcast-progress', resource, (signal) =>
    get<EpisodeProgress[]>(
      '/progress',
      { podcastId: String(podcastId) },
      undefined,
      signal,
    ),
  );
  const query = useQuery({
    ...options,
    enabled: options.enabled && token.scope !== null && !!podcastId,
    staleTime: 30_000,
  });
  const rows = session.current(token, resource) ? query.data : undefined;
  const authoritative = useEpisodeProgress(
    (rows ?? []).map((row) => row.episodeId),
  );
  return useMemo(
    () =>
      new Map([
        ...(rows ?? []).map((row) => [row.episodeId, row] as const),
        ...authoritative,
      ]),
    [rows, authoritative],
  );
}

export function useMarkPlayed(podcastId: string | undefined) {
  const session = useAccountSession();
  const token = session.token();
  return useMutation({
    mutationKey: accountQueryKey(token.scope, 'mark-played'),
    mutationFn: (episodeId: string) =>
      stateRuntime(session).sync.progress(episodeId, 'played', 0),
    onSuccess: () => {
      if (!session.current(token)) return;
      invalidateProgress(session);
      void session.client.invalidateQueries({
        queryKey: accountQueryKey(token.scope, 'episodes', podcastId ?? 0),
      });
    },
  });
}

export interface RecentProgress {
  episode: IEpisodeInfo;
  position: number;
}

export function useRecentProgress(limit: number) {
  const session = useAccountSession();
  const token = session.token();
  const options = session.query('recent-progress', 'playback', (signal) =>
    get<RecentProgress[]>(
      '/progress',
      { recent: String(limit) },
      undefined,
      signal,
    ),
  );
  const query = useQuery({
    ...options,
    queryKey: [...options.queryKey, limit],
    enabled: options.enabled && token.scope !== null,
    staleTime: 30_000,
  });
  return session.current(token, 'playback') ? (query.data ?? []) : [];
}

export function episodeProgressQueries(
  session: AccountSession,
  episodeIds: readonly string[],
) {
  const ids = [...new Set(episodeIds)].sort(compareCanonicalIds);
  return Array.from({ length: Math.ceil(ids.length / 200) }, (_, index) => {
    const batch = ids.slice(index * 200, (index + 1) * 200).join(',');
    const options = session.query('episode-progress', 'playback', () =>
      stateRuntime(session).sync.readProgress(batch.split(',')),
    );
    return {
      ...options,
      queryKey: [...options.queryKey, batch],
      enabled: options.enabled && session.scope !== null,
      staleTime: 30_000,
    };
  });
}

export function useEpisodeProgress(episodeIds: readonly string[]) {
  const session = useAccountSession();
  const token = session.token();
  const queries = useQueries({
    queries: episodeProgressQueries(session, episodeIds),
  });
  const durable = useDurableState();
  const rows = new Map(
    (session.current(token, 'playback')
      ? queries.flatMap((query) => query.data ?? [])
      : []
    ).map((row) => [row.episodeId, row]),
  );
  for (const row of durable.progress.values())
    rows.set(row.episodeId, {
      episodeId: row.episodeId,
      position: row.positionSeconds,
      completed: row.completed,
    });
  return rows;
}

export function invalidateProgress(session: AccountSession) {
  for (const kind of [
    'episode-progress',
    'podcast-progress',
    'recent-progress',
  ])
    void session.client.invalidateQueries({
      queryKey: accountQueryKey(session.scope, kind),
    });
}
