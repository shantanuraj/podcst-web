import React from 'react';
import { createWorkerFactory, useWorker } from '@shopify/react-web-worker';

import { IEpisodeInfo } from '@/types';
import { SortPreference } from './types';

const createWorker = createWorkerFactory(() => import('./sortFilterEpisodes'));

export const useEpisodesFilter = (
  episodes: IEpisodeInfo[],
  sortPreference: SortPreference,
  query: string,
) => {
  const cancelUpdate = React.useRef(false);
  const [filteredEpisodes, setFilteredEpisodes] = React.useState<IEpisodeInfo[]>(episodes);
  const worker = useWorker(createWorker);

  React.useEffect(() => {
    cancelUpdate.current = false;
    return () => {
      cancelUpdate.current = true;
    };
  }, [query, sortPreference, episodes]);

  React.useEffect(() => {
    async function sortAndFilter() {
      const result = await worker.sortFilterEpisodes(episodes, sortPreference, query);
      if (cancelUpdate.current) return;
      setFilteredEpisodes(result);
    }
    sortAndFilter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sortPreference, episodes]);

  return filteredEpisodes;
};
