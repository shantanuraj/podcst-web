import { isFeedUrlInput } from '@/shared/feed-url';
import type { IEpisodeInfo, IPodcastSearchResult } from '@/types';
import { feedError, readFeedBody } from '../ingest/interactive-response';
import { privateFeedHeaders as headers } from '../podcast-access';
import { SearchAdmissionError } from './limits';

type LimitSearch = (request: Request) => Promise<void>;
type Session = { id: string; userId: string };

function searchError(error: unknown) {
  const failure =
    error instanceof SearchAdmissionError ? error : new SearchAdmissionError();
  return Response.json(
    {
      code: failure.status === 429 ? 'rate_limited' : 'unavailable',
      message: failure.message,
    },
    {
      status: failure.status,
      headers: { ...headers, 'Retry-After': String(failure.retryAfter) },
    },
  );
}

function invalidTerm() {
  return Response.json(
    { message: 'A search term is required' },
    { status: 400, headers },
  );
}

export function createPodcastSearchHandlers({
  limit,
  search,
  getSession,
}: {
  limit: LimitSearch;
  search: (
    term: string,
    locale?: string,
    session?: Session | null,
    signal?: AbortSignal,
  ) => Promise<IPodcastSearchResult[]>;
  getSession: () => Promise<Session | null>;
}) {
  return {
    async GET(request: Request) {
      const url = new URL(request.url);
      const term = url.searchParams.get('term')?.trim();
      const locale = url.searchParams.get('locale') || undefined;
      if (!term || term.length > 4096) return invalidTerm();
      if (isFeedUrlInput(term))
        return Response.json(
          { message: 'Use authenticated POST for RSS links' },
          { status: 400, headers },
        );
      try {
        await limit(request);
        return Response.json(await search(term, locale));
      } catch (error) {
        return searchError(error);
      }
    },
    async POST(request: Request) {
      let body: Record<string, unknown>;
      try {
        body = await readFeedBody(request);
      } catch (error) {
        return feedError(error);
      }
      const term = typeof body.term === 'string' ? body.term.trim() : '';
      const locale = typeof body.locale === 'string' ? body.locale : undefined;
      if (!term || term.length > 4096) return invalidTerm();
      if (isFeedUrlInput(term)) {
        try {
          const session = await getSession();
          if (!session)
            return Response.json(
              { message: 'Sign in to open an RSS link' },
              { status: 401, headers },
            );
          return Response.json(
            await search(term, locale, session, request.signal),
            { headers },
          );
        } catch (error) {
          return feedError(error);
        }
      }
      try {
        await limit(request);
        return Response.json(await search(term, locale), { headers });
      } catch (error) {
        return searchError(error);
      }
    },
  };
}

export function createEpisodeSearchHandler(
  limit: LimitSearch,
  search: (term: string) => Promise<IEpisodeInfo[]>,
) {
  return async (request: Request) => {
    const term = new URL(request.url).searchParams.get('term')?.trim() ?? '';
    if (!term || term.length > 200 || isFeedUrlInput(term))
      return invalidTerm();
    try {
      await limit(request);
      return Response.json(await search(term), {
        headers: { 'Cache-Control': 'public, s-maxage=300' },
      });
    } catch (error) {
      return searchError(error);
    }
  };
}
