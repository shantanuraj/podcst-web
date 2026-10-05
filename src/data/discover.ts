import { useQuery } from '@tanstack/react-query';
import type { IPodcast } from '@/types';
import { get } from './api';

export type Noteworthy = IPodcast & { firstPublished: number | null };

export function useNoteworthy(
  locale: string,
  category: number | null,
  initial: Noteworthy[],
) {
  return useQuery({
    queryKey: ['noteworthy', locale, category],
    queryFn: ({ signal }) =>
      get<Noteworthy[]>(
        '/noteworthy',
        category === null ? { locale } : { locale, category },
        undefined,
        signal,
      ),
    initialData: category === null ? initial : undefined,
    placeholderData: (previous) => previous,
    staleTime: 15 * 60_000,
  });
}

export function useRelated(podcastId: number, locale: string | null) {
  return useQuery({
    queryKey: ['related', podcastId, locale],
    queryFn: ({ signal }) =>
      get<IPodcast[]>(
        '/feed/related',
        { id: podcastId, locale: locale ?? 'us' },
        undefined,
        signal,
      ),
    enabled: locale !== null,
    staleTime: 15 * 60_000,
  });
}
