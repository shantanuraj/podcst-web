import { useQuery } from '@tanstack/react-query';

import { IPodcastSearchResult } from '@/types';
import { get } from './api';

const searchTerm = async (term: string): Promise<IPodcastSearchResult[]> => {
  if (!term || term.trim().length === 0) return [];
  return get<IPodcastSearchResult[]>(`/search`, { term });
};

export const useSearch = (term: string) => {
  return useQuery({
    queryKey: ['search', term],
    queryFn: () => searchTerm(term),
    enabled: !!term && term.trim().length > 0,
    staleTime: 30 * 1000,
  });
};
