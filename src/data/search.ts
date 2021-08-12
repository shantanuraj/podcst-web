import useSWR from 'swr';

import { IPodcastSearchResult } from '../types';
import { get } from './api';

export const searchTerm = async (term: string) => {
  try {
    return get<IPodcastSearchResult[]>(`/search`, { term: encodeURIComponent(term) });
  } catch (err) {
    console.error(`Api.search`, `Couldn't get results for ${term}`, err);
    throw err;
  }
};

export const useSearch = (term: string) => {
  const response = useSWR(term ? term : null, searchTerm);
  return response;
};
