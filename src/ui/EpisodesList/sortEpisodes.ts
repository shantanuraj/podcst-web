import { IEpisodeInfo } from '../../types';

import { SortPreference } from './types';

export const sortOptionsMap: Record<SortPreference, { value: SortPreference; title: string }> = {
  releaseDesc: {
    title: 'Release date (New → Old)',
    value: 'releaseDesc',
  },
  releaseAsc: {
    title: 'Release date (Old → New)',
    value: 'releaseAsc',
  },
  titleAsc: {
    title: 'Title (A → Z)',
    value: 'titleAsc',
  },
  titleDesc: {
    title: 'Title (Z → A)',
    value: 'titleDesc',
  },
  lengthAsc: {
    title: 'Duration (Short → Long)',
    value: 'lengthAsc',
  },
  lengthDesc: {
    title: 'Duration (Long → Short)',
    value: 'lengthDesc',
  },
};

export const sortOptions = Object.values(sortOptionsMap);

export const sortEpisodes = (episodes: IEpisodeInfo[], sortPreference: SortPreference) => {
  const sortFn = (a: IEpisodeInfo, b: IEpisodeInfo) => {
    switch (sortPreference) {
      case sortOptionsMap.releaseAsc.value:
        return (a.published || 0) - (b.published || 0);
      case sortOptionsMap.titleAsc.value:
        return a.title.localeCompare(b.title);
      case sortOptionsMap.titleDesc.value:
        return b.title.localeCompare(a.title);
      case sortOptionsMap.lengthAsc.value:
        return (a.duration || 0) - (b.duration || 0);
      case sortOptionsMap.lengthDesc.value:
        return (b.duration || 0) - (a.duration || 0);
      default:
        return 0;
    }
  };
  return sortPreference === sortOptionsMap.releaseDesc.value
    ? episodes
    : episodes.slice().sort(sortFn);
};
