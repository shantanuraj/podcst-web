import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useAccountSession } from '@/shared/auth/AccountBoundary';
import { accountQueryKey } from '@/shared/auth/account';
import type { AccountSession } from '@/shared/auth/account-session';
import type { EpisodeProgress, IEpisodeInfo } from '@/types';
import { get, responseData } from './api';

export function usePodcastProgress(podcastId: number | undefined) {
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
  return useMemo(
    () => new Map((rows ?? []).map((row) => [row.episodeId, row])),
    [rows],
  );
}

export function useMarkPlayed(podcastId: number | undefined) {
  const session = useAccountSession();
  const token = session.token();
  return useMutation({
    mutationKey: accountQueryKey(token.scope, 'mark-played'),
    mutationFn: (episodeId: number) =>
      session.run(token, 'playback', async (signal) =>
        responseData(
          await fetch('/api/progress', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ episodeId, position: 0, completed: true }),
            signal,
          }),
        ),
      ),
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
  episodeIds: readonly number[],
) {
  const ids = [...new Set(episodeIds)].sort((a, b) => a - b);
  return Array.from({ length: Math.ceil(ids.length / 200) }, (_, index) => {
    const batch = ids.slice(index * 200, (index + 1) * 200).join(',');
    const options = session.query('episode-progress', 'playback', (signal) =>
      get<EpisodeProgress[]>(
        '/progress',
        { episodeIds: batch },
        undefined,
        signal,
      ),
    );
    return {
      ...options,
      queryKey: [...options.queryKey, batch],
      enabled: options.enabled && session.scope !== null,
      staleTime: 30_000,
    };
  });
}

export function useEpisodeProgress(episodeIds: readonly number[]) {
  const session = useAccountSession();
  const token = session.token();
  const queries = useQueries({
    queries: episodeProgressQueries(session, episodeIds),
  });
  return new Map(
    (session.current(token, 'playback')
      ? queries.flatMap((query) => query.data ?? [])
      : []
    ).map((row) => [row.episodeId, row]),
  );
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
