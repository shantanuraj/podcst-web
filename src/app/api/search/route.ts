import { getSession } from '@/server/auth/session';
import { limitSearch } from '@/server/search/admission';
import { createPodcastSearchHandlers } from '@/server/search/handlers';
import { search } from './search';

export const runtime = 'nodejs';

export const { GET, POST } = createPodcastSearchHandlers({
  limit: limitSearch,
  search,
  getSession,
});
