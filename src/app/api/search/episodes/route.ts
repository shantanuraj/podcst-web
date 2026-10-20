import { sql } from '@/server/db';
import { searchEpisodes } from '@/server/search';
import { limitSearch } from '@/server/search/admission';
import { createEpisodeSearchHandler } from '@/server/search/handlers';

export const runtime = 'nodejs';

export const GET = createEpisodeSearchHandler(limitSearch, (term) =>
  searchEpisodes(sql, term),
);
