import { IEpisodeInfo } from '../../types';
import { filterEpisodes } from './filterEpisodes';
import { sortEpisodes } from './sortEpisodes';
import { SortPreference } from './types';

export const sortFilterEpisodes = (
  episodes: IEpisodeInfo[],
  sortPreference: SortPreference,
  query: string,
) => {
  return sortEpisodes(filterEpisodes(episodes, query), sortPreference);
};
