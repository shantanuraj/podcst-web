import type { InfiniteData } from '@tanstack/react-query';
import type { IEpisodeInfo, IPaginatedEpisodes } from '@/types';
import type { FeedFreshness } from './feed-contract';

type Content = { episodes: IEpisodeInfo[]; freshness?: FeedFreshness };

export function preserveFeedContent<T extends Content>(
  previous: Content | undefined,
  next: T,
): T {
  if (
    !previous ||
    !next.freshness ||
    (next.freshness.content !== 'missing' &&
      !['pending', 'backoff'].includes(next.freshness.state))
  )
    return next;
  const key = (episode: IEpisodeInfo) =>
    episode.id ?? `${episode.feed}\u001f${episode.guid}`;
  const present = new Set(next.episodes.map(key));
  return {
    ...next,
    episodes: [
      ...next.episodes,
      ...previous.episodes.filter((episode) => !present.has(key(episode))),
    ],
  };
}

export function preserveEpisodePages(
  previous: InfiniteData<IPaginatedEpisodes> | undefined,
  next: InfiniteData<IPaginatedEpisodes>,
): InfiniteData<IPaginatedEpisodes> {
  if (!previous?.pages || !next.pages?.[0]) return next;
  const first = next.pages[0];
  if (first.freshness?.content !== 'missing') return next;
  return {
    ...next,
    pages: [
      preserveFeedContent(
        { episodes: previous.pages.flatMap((page) => page.episodes) },
        first,
      ),
      ...next.pages.slice(1),
    ],
  };
}
