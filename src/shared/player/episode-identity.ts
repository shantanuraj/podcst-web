import type { IEpisodeInfo } from '@/types';

export function sameEpisode(first?: IEpisodeInfo, second?: IEpisodeInfo) {
  if (!first || !second) return false;
  return first.id || second.id
    ? !!first.id && first.id === second.id
    : first.feed === second.feed && first.guid === second.guid;
}

export const episodeKey = (episode: IEpisodeInfo) =>
  episode.id
    ? `id:${episode.id}`
    : `local:${episode.feed}\u001f${episode.guid}`;
