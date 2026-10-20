import { expect, test } from 'bun:test';
import {
  createEpisodeSearchHandler,
  createPodcastSearchHandlers,
} from './handlers';
import { SearchAdmissionError } from './limits';

function fixture(error?: Error) {
  const events: unknown[] = [];
  const limit = async (request: Request) => {
    events.push(['limit', request.method]);
    if (error) throw error;
  };
  const dependencies = {
    limit,
    search: async (...args: unknown[]) => {
      events.push(['search', ...args.slice(0, 3)]);
      return [];
    },
    getSession: async () => {
      events.push(['session']);
      return { id: 'session', userId: 'owner' };
    },
  };
  return {
    ...createPodcastSearchHandlers(dependencies),
    episodes: createEpisodeSearchHandler(limit, async (term) => {
      events.push(['episodes', term]);
      return [];
    }),
    events,
    dependencies,
  };
}
const get = (term = 'history') =>
  new Request(
    `https://example.invalid/api/search?term=${encodeURIComponent(term)}`,
  );
const post = (term = 'history') =>
  new Request('https://example.invalid/api/search', {
    method: 'POST',
    body: JSON.stringify({ term, locale: 'us' }),
  });

test('all text search entry points admit before work and preserve success cache policy', async () => {
  const f = fixture();
  const responses = [
    await f.GET(get()),
    await f.POST(post()),
    await f.episodes(get()),
  ];
  expect(f.events).toEqual([
    ['limit', 'GET'],
    ['search', 'history', undefined],
    ['limit', 'POST'],
    ['search', 'history', 'us'],
    ['limit', 'GET'],
    ['episodes', 'history'],
  ]);
  for (const response of responses) {
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  }
  expect(responses[1].headers.get('cache-control')).toBe('private, no-store');
  expect(responses[2].headers.get('cache-control')).toBe(
    'public, s-maxage=300',
  );
});

test('throttling and admission failures suppress work on GET, POST and episode search', async () => {
  for (const error of [
    new SearchAdmissionError(429, 17),
    new Error('redis credentials'),
  ]) {
    const f = fixture(error);
    for (const response of [
      await f.GET(get()),
      await f.POST(post()),
      await f.episodes(get()),
    ]) {
      expect(response.status).toBe(
        error instanceof SearchAdmissionError ? 429 : 503,
      );
      expect(response.headers.get('retry-after')).toBe(
        error instanceof SearchAdmissionError ? '17' : '5',
      );
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await response.json()).toEqual(
        error instanceof SearchAdmissionError
          ? { code: 'rate_limited', message: 'Too many search requests' }
          : { code: 'unavailable', message: 'Search unavailable' },
      );
    }
    expect(f.events).toEqual([
      ['limit', 'GET'],
      ['limit', 'POST'],
      ['limit', 'GET'],
    ]);
  }
});

test('invalid text and bodies do not spend search budget or start work', async () => {
  const f = fixture();
  for (const request of [
    get(''),
    get('a'.repeat(4097)),
    get('https://example.invalid/feed.xml'),
  ])
    expect((await f.GET(request)).status).toBe(400);
  for (const request of [
    get(''),
    get('a'.repeat(201)),
    get('https://example.invalid/feed.xml'),
  ])
    expect((await f.episodes(request)).status).toBe(400);
  for (const request of [
    post(''),
    post('a'.repeat(4097)),
    new Request('https://example.invalid', { method: 'POST', body: '{' }),
  ])
    expect((await f.POST(request)).status).toBe(400);
  expect(f.events).toEqual([]);
});

test('RSS imports retain authentication and existing feed admission without spending text-search budget', async () => {
  const f = fixture(new SearchAdmissionError());
  const term = 'https://example.invalid/feed.xml';
  expect((await f.POST(post(term))).status).toBe(200);
  expect(f.events).toEqual([
    ['session'],
    ['search', term, 'us', { id: 'session', userId: 'owner' }],
  ]);
  const guest = createPodcastSearchHandlers({
    ...f.dependencies,
    getSession: async () => null,
  });
  const response = await guest.POST(post(term));
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({
    message: 'Sign in to open an RSS link',
  });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(f.events).toHaveLength(2);
});

test('search execution failures are private and redacted', async () => {
  const fail = async () => {
    throw new Error('private SQL or upstream response');
  };
  const f = fixture();
  const podcasts = createPodcastSearchHandlers({
    ...f.dependencies,
    search: fail,
  });
  const episodes = createEpisodeSearchHandler(f.dependencies.limit, fail);
  for (const response of [
    await podcasts.GET(get()),
    await podcasts.POST(post()),
    await episodes(get()),
  ]) {
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: 'unavailable',
      message: 'Search unavailable',
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  }
});
