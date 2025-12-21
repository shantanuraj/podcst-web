import { useMemo } from 'react';

import type { IEpisodeInfo } from '@/types';
import { filterEpisodes } from './filterEpisodes';
import { sortEpisodes } from './sortEpisodes';
import type { SortPreference } from './types';

export const useEpisodesFilter = (
  episodes: IEpisodeInfo[],
  sortPreference: SortPreference,
  query: string,
) => {
  return useMemo(
    () => sortEpisodes(filterEpisodes(episodes, query), sortPreference),
    [episodes, sortPreference, query],
  );
};
