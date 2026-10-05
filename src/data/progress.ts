import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useAccountSession } from '@/shared/auth/AccountBoundary';
import { accountQueryKey } from '@/shared/auth/account';
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
      void session.client.invalidateQueries({
        queryKey: accountQueryKey(
          token.scope,
          'podcast-progress',
          podcastId ?? 0,
        ),
      });
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

export function useEpisodeProgress(episodeIds: readonly number[]) {
  const session = useAccountSession();
  const token = session.token();
  const ids = [...new Set(episodeIds)].sort((a, b) => a - b).slice(0, 200);
  const options = session.query('episode-progress', 'playback', (signal) =>
    get<EpisodeProgress[]>(
      '/progress',
      { episodeIds: ids.join(',') },
      undefined,
      signal,
    ),
  );
  const query = useQuery({
    ...options,
    queryKey: [...options.queryKey, ids.join(',')],
    enabled: options.enabled && token.scope !== null && ids.length > 0,
    staleTime: 30_000,
  });
  const rows = session.current(token, 'playback') ? query.data : undefined;
  return useMemo(
    () => new Map((rows ?? []).map((row) => [row.episodeId, row])),
    [rows],
  );
}
