export const episodesQueryKey = (
  podcastId: number,
  search = '',
  sortBy = 'published',
  sortDir = 'desc',
) => ['episodes', podcastId, search, sortBy, sortDir];
