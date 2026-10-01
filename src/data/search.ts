import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/shared/auth/useAuth';
import { isFeedUrlInput } from '@/shared/feed-url';
import type { IPodcastSearchResult } from '@/types';
import { get, post } from './api';

export const useSearch = (input: string) => {
  const term = input.trim();
  const { data: user, isPending } = useSession();
  const url = isFeedUrlInput(term);
  const query = useQuery({
    queryKey: ['search', user?.id ?? null, term],
    queryFn: () =>
      url
        ? post<IPodcastSearchResult[]>('/search', { term })
        : get<IPodcastSearchResult[]>('/search', { term }),
    enabled: !!term && (!url || !!user),
    staleTime: 30_000,
    gcTime: url ? 0 : 5 * 60_000,
    retry: false,
  });
  return { ...query, needsSignIn: url && !isPending && !user };
};
