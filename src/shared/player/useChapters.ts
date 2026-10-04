import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { chapterQueryOptions } from '@/data/chapters';
import { useAccountSession } from '@/shared/auth/AccountBoundary';
import { type EpisodeChapters, showNoteChapters } from '@/shared/chapters';
import type { IEpisodeInfo } from '@/types';

const empty: EpisodeChapters = { chapters: [], source: 'none' };

export function useChapters(episode?: IEpisodeInfo) {
  const session = useAccountSession();
  const view = useMemo(
    () => ({ episode, token: session.token() }),
    [episode, session],
  );
  const available =
    session.current(view.token, episode?.podcastId) &&
    !(episode?.isPrivate && view.token.scope === null);
  const options = chapterQueryOptions(session, episode);
  const query = useQuery({ ...options, enabled: options.enabled && available });
  const fallback = useMemo<EpisodeChapters>(() => {
    const chapters = showNoteChapters(episode?.showNotes ?? '');
    return { chapters, source: chapters.length ? 'shownotes' : 'none' };
  }, [episode?.showNotes]);
  return {
    ...(available
      ? query.isError
        ? fallback
        : (query.data ?? fallback)
      : empty),
    loading: available && query.isFetching,
  };
}
