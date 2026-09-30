import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { episodesQueryKey } from '@/data/episode-query';
import type { IPaginatedEpisodes } from '@/types';

export function EpisodesHydration({
  podcastId,
  initialData,
  children,
}: {
  podcastId: number;
  initialData: IPaginatedEpisodes;
  children: ReactNode;
}) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(episodesQueryKey(podcastId), {
    pages: [initialData],
    pageParams: [undefined],
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {children}
    </HydrationBoundary>
  );
}
