import { dehydrate, QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { episodesQueryKey } from '@/data/episode-query';
import { AccountHydration } from '@/shared/auth/AccountHydration';
import type { AccountScope } from '@/shared/auth/account';
import type { IPaginatedEpisodes } from '@/types';

export function EpisodesHydration({
  scope,
  podcastId,
  initialData,
  children,
}: {
  scope: AccountScope;
  podcastId: string;
  initialData: IPaginatedEpisodes;
  children: ReactNode;
}) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(episodesQueryKey(scope, podcastId), {
    pages: [initialData],
    pageParams: [undefined],
  });

  return (
    <AccountHydration
      scope={scope}
      resource={podcastId}
      state={dehydrate(queryClient)}
    >
      {children}
    </AccountHydration>
  );
}
