import { type MatchSorterOptions, matchSorter, rankings } from 'match-sorter';

import type { IEpisodeInfo } from '@/types';

const matchSorterOptions: MatchSorterOptions<IEpisodeInfo> = {
  threshold: rankings.CONTAINS,
  keys: [
    (episode) => episode.title,
    (episode) => episode.showNotes,
    (episode) => episode.summary || '',
  ],
};

export const filterEpisodes = (episodes: IEpisodeInfo[], query: string) => {
  if (!query) return episodes;
  return matchSorter(episodes, query, matchSorterOptions);
};
