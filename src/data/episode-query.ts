import { type AccountScope, accountQueryKey } from '@/shared/auth/account';

export const episodesQueryKey = (
  scope: AccountScope,
  podcastId: string,
  search = '',
  sortBy = 'published',
  sortDir = 'desc',
  unplayed = false,
) =>
  accountQueryKey(
    scope,
    'episodes',
    podcastId,
    search,
    sortBy,
    sortDir,
    unplayed,
  );
