'use client';

import {
  type DehydratedState,
  HydrationBoundary,
  type InfiniteData,
} from '@tanstack/react-query';
import { type ReactNode, useRef } from 'react';
import { preserveEpisodePages } from '@/shared/feed-content';
import type { IPaginatedEpisodes } from '@/types';
import { useAccountSession } from './AccountBoundary';
import type { AccountScope } from './account';

export function AccountHydration({
  scope,
  resource,
  state,
  children,
}: {
  scope: AccountScope;
  resource: string;
  state: DehydratedState;
  children: ReactNode;
}) {
  const session = useAccountSession();
  const token = session.token();
  const revision = useRef(token.revision).current;
  if (
    scope !== token.scope ||
    revision !== token.revision ||
    !session.current(token, resource)
  )
    return children;
  const preserved = {
    ...state,
    queries: state.queries.map((query) =>
      query.queryKey[2] === 'episodes'
        ? {
            ...query,
            state: {
              ...query.state,
              data: preserveEpisodePages(
                session.client.getQueryData<InfiniteData<IPaginatedEpisodes>>(
                  query.queryKey,
                ),
                query.state.data as InfiniteData<IPaginatedEpisodes>,
              ),
            },
          }
        : query,
    ),
  };
  return <HydrationBoundary state={preserved}>{children}</HydrationBoundary>;
}
