import { type AccountScope, accountQueryKey } from '@/shared/auth/account';

export const episodesQueryKey = (
  scope: AccountScope,
  podcastId: number,
  search = '',
  sortBy = 'published',
  sortDir = 'desc',
) => accountQueryKey(scope, 'episodes', podcastId, search, sortBy, sortDir);
