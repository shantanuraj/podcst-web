import { accountQueryKey } from '@/shared/auth/account';
import type { AccountSession } from '@/shared/auth/account-session';
import type { EpisodeChapters } from '@/shared/chapters';
import type { IEpisodeInfo } from '@/types';
import { responseData } from './api';

export function chapterQueryOptions(
  session: AccountSession,
  episode?: IEpisodeInfo,
) {
  const token = session.token();
  const options = session.query(
    'chapters',
    episode?.podcastId ?? `episode:${episode?.id}`,
    async (signal) =>
      responseData<EpisodeChapters>(
        await fetch(`/api/episodes/${episode?.id}/chapters`, {
          signal,
          cache: 'no-store',
        }),
      ),
  );
  return {
    ...options,
    queryKey: accountQueryKey(
      token.scope,
      'chapters',
      episode?.id ?? null,
      token.revision,
    ),
    enabled:
      options.enabled &&
      !!episode?.id &&
      !(episode.isPrivate && token.scope === null),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchInterval: 60_000,
    retry: false,
  };
}
