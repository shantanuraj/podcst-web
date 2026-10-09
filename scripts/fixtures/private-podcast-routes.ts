import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { NextRequest } from 'next/server';
import { seedFollow, seedProgress } from '../lib/state-fixture';
import { mockFeedTransport } from './feed-transport';

mockFeedTransport();

const socket = process.env.PODCST_TEST_SOCKET;
const feed = process.env.PODCST_TEST_FEED;
assert(socket && feed, 'Isolated test target required');
const directory = realpathSync(socket);
assert.equal(dirname(directory), realpathSync(tmpdir()));
assert(basename(directory).startsWith('podcst-pg-'));
assert.equal(lstatSync(directory).uid, process.getuid?.());
assert.equal(lstatSync(directory).mode & 0o077, 0);
Object.assign(process.env, {
  VERCEL: '0',
  PG_HOST: directory,
  PGHOST: directory,
  PG_PORT: '5432',
  PGPORT: '5432',
  PG_USER: 'postgres',
  PG_DATABASE: 'postgres',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '1',
  REDIS_URL: 'redis://127.0.0.1:1',
  MTLS_CA: '',
  MTLS_CERT: '',
  MTLS_KEY: '',
});
delete process.env.DATABASE_URL;

let actor: string | null = null;
let cachedTop: unknown[] = [];
let shortLink: { feed: string; guid: string } | null = null;
mock.module('@/server/auth/session', () => ({
  getSession: async () =>
    actor ? { userId: actor, id: `fixture-${actor}` } : null,
}));
mock.module('@/app/api/redis', () => ({
  isCached: () => true,
  cache: {
    feed: async () => {
      throw new Error('Legacy feed cache must not be read');
    },
    top: async () => ({ entity: cachedTop, timestamp: 1 }),
    saveTop: async () => {},
    getShortUrl: async () => shortLink,
  },
}));

const { sql } = await import('../../src/server/db');
assert.equal(
  realpathSync((await sql`SHOW data_directory`)[0].data_directory),
  realpathSync(join(directory, 'data')),
);
const { createProgressStateService } = await import(
  '../../src/server/state/progress'
);
const { createFollowStateService } = await import(
  '../../src/server/state/follows'
);
const { createStateChangeHandlers } = await import(
  '../../src/server/state/response'
);
const progressState = createProgressStateService(sql);
const followState = createFollowStateService(sql);
mock.module('@/server/state', () => ({
  progressState,
  followState,
  limitState: async () => {},
  stateChanges: createStateChangeHandlers(
    { progress: progressState.change, follows: followState.change },
    async () => actor,
    async () => {},
  ),
}));
const [{ generation }] = await sql`SELECT generation FROM state_generation`;
await sql`INSERT INTO sessions (id, user_id, expires_at) SELECT 'fixture-' || id, id, now() + interval '1 day' FROM users`;
const scope = () => ({ protocol: 1, accountId: actor, generation });
const batch = (changes: unknown[]) => ({
  ...scope(),
  clientId: randomUUID(),
  sequence: '1',
  changes,
});
const search = await import('../../src/app/api/search/route');
const feedRoute = await import('../../src/app/api/feed/route');
const info = await import('../../src/app/api/feed/info/route');
const episodes = await import('../../src/app/api/feed/episodes/route');
const refresh = await import('../../src/app/api/feed/refresh/route');
const subscriptions = await import('../../src/app/api/subscriptions/route');
const resolution = await import(
  '../../src/app/api/subscriptions/resolve/route'
);
const progress = await import('../../src/app/api/progress/route');
const top = await import('../../src/app/api/top/route');
const { default: shortPage } = await import('../../src/app/s/[slug]/page');
const readers = await import('../../src/server/ingest/podcast');
const progressStore = await import('../../src/server/progress');

function request(path: string, body?: unknown) {
  return new NextRequest(
    `http://localhost${path}`,
    body === undefined
      ? {}
      : {
          method: path === '/api/progress' ? 'PUT' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Podcst-Client': 'native',
          },
          body: JSON.stringify(body),
        },
  );
}

try {
  const before = (await sql`SELECT count(*)::int AS n FROM podcasts`)[0].n;
  assert.equal(
    (await search.POST(request('/api/search', { term: feed }))).status,
    401,
  );
  assert.equal(
    (await feedRoute.POST(request('/api/feed', { url: feed }))).status,
    401,
  );
  assert.equal(
    (await search.GET(request(`/api/search?term=${encodeURIComponent(feed)}`)))
      .status,
    400,
  );
  assert.equal(
    (await sql`SELECT count(*)::int AS n FROM podcasts`)[0].n,
    before,
  );

  actor = 'owner';
  const imported = await search.POST(
    request('/api/search', {
      term: feed,
      owner_user_id: 'other',
      isPrivate: false,
      itunes_id: 999,
    }),
  );
  assert.equal(imported.status, 200);
  assert.equal(imported.headers.get('Cache-Control'), 'private, no-store');
  const [result] = await imported.json();
  assert.equal(result.isPrivate, true);
  assert.equal(
    (await sql`SELECT owner_user_id FROM podcasts WHERE id = ${result.id}`)[0]
      .owner_user_id,
    'owner',
  );
  const id = result.id;
  const [episode] =
    await sql`SELECT id, guid FROM episodes WHERE podcast_id = ${id} ORDER BY id LIMIT 1`;
  const episodeId = String(episode.id);
  assert.equal(
    (await feedRoute.GET(request(`/api/feed?id=${id}`))).status,
    200,
  );
  assert.equal(
    (await info.GET(request(`/api/feed/info?id=${id}`))).status,
    200,
  );
  assert.equal(
    (await episodes.GET(request(`/api/feed/episodes?podcastId=${id}`))).status,
    200,
  );
  assert.equal(
    (
      await subscriptions.POST(
        request(
          '/api/subscriptions',
          batch([{ podcastId: id, followed: true }]),
        ),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await progress.PUT(
        request(
          '/api/progress',
          batch([{ episodeId, positionSeconds: 37, completed: false }]),
        ),
      )
    ).status,
    200,
  );
  assert.equal((await progress.GET(request('/api/progress'))).status, 200);
  assert.equal(
    (await (await progress.GET(request('/api/progress'))).json()).episode
      .isPrivate,
    true,
  );
  assert.equal(
    (await (await subscriptions.GET(request('/api/subscriptions'))).json())[0]
      .isPrivate,
    true,
  );
  assert.equal(
    (await readers.getEpisodeById(episodeId, 'owner'))?.isPrivate,
    true,
  );
  assert.equal(await readers.getEpisodeById(episodeId), null);
  assert.equal(await readers.getPodcastInfoById(id), null);
  assert.equal(
    (await readers.getEpisodesPaginated({ podcastId: id })).episodes.length,
    0,
  );
  assert(
    !JSON.stringify(await readers.getPodcastById(id, 'owner')).includes(
      'owner_user_id',
    ),
  );

  shortLink = { feed, guid: episode.guid };
  await assert.rejects(
    shortPage({ params: Promise.resolve({ slug: 'synthetic' }) }),
    (error: unknown) => {
      const redirect = error as { digest?: string };
      return redirect.digest === 'NEXT_REDIRECT;replace;/;307;';
    },
  );
  cachedTop = [{ id, feed, title: 'must-not-leak', cover: '', author: '' }];
  assert.deepEqual(
    await (await top.GET(request('/api/top?locale=us&limit=20'))).json(),
    [],
  );

  for (const user of [null, 'other']) {
    actor = user;
    assert.equal(
      (await feedRoute.GET(request(`/api/feed?id=${id}`))).status,
      404,
    );
    assert.equal(
      (
        await feedRoute.GET(
          request(`/api/feed?url=${encodeURIComponent(feed)}`),
        )
      ).status,
      404,
    );
    assert.equal(
      (await info.GET(request(`/api/feed/info?id=${id}`))).status,
      404,
    );
    assert.equal(
      (await episodes.GET(request(`/api/feed/episodes?podcastId=${id}`)))
        .status,
      404,
    );
    assert.equal(
      (
        await refresh.POST(
          request('/api/feed/refresh', { podcastId: id, onlyIfStale: true }),
        )
      ).status,
      404,
    );
    assert.equal(await readers.getEpisodeById(episodeId, user), null);
    assert.equal(
      (await readers.getEpisodesPaginated({ podcastId: id }, user)).episodes
        .length,
      0,
    );
    assert.equal(
      (await search.POST(request('/api/search', { term: feed }))).status,
      user ? 404 : 401,
    );
  }

  actor = 'other';
  const deniedFollow = await subscriptions.POST(
    request('/api/subscriptions', batch([{ podcastId: id, followed: true }])),
  );
  assert.equal(deniedFollow.status, 200);
  assert.equal((await deniedFollow.json()).results[0].status, 'not_found');
  const deniedProgress = await progress.PUT(
    request(
      '/api/progress',
      batch([{ episodeId, positionSeconds: 99, completed: false }]),
    ),
  );
  assert.equal(deniedProgress.status, 200);
  assert.equal((await deniedProgress.json()).results[0].status, 'not_found');
  assert.equal(
    await (await progress.GET(request('/api/progress'))).json(),
    null,
  );
  assert.deepEqual(
    await (
      await resolution.POST(
        request('/api/subscriptions/resolve', { ...scope(), feedUrls: [feed] }),
      )
    ).json(),
    {
      ...scope(),
      items: [
        {
          index: 0,
          podcastId: null,
          status: 'unavailable',
          retryAfterSeconds: null,
        },
      ],
    },
  );
  await seedFollow(sql, 'other', id);
  await seedProgress(sql, 'other', episodeId, 88);
  assert.deepEqual(
    await (await subscriptions.GET(request('/api/subscriptions'))).json(),
    [],
  );
  assert.equal(
    await (await progress.GET(request('/api/progress'))).json(),
    null,
  );
  assert.deepEqual(
    await progressStore.getEpisodeProgress('other', [episodeId]),
    [],
  );
  assert.equal(
    (
      await sql`SELECT position FROM playback_progress WHERE user_id = 'owner' AND episode_id = ${episodeId}`
    )[0].position,
    37,
  );
  const { indexPodcast } = await import(
    '../../src/server/ingest/index-podcast'
  );
  const { registerPublicAliases } = await import(
    '../../src/server/ingest/feed-aliases'
  );
  await indexPodcast(sql, feed, '999');
  const alias = 'https://public.example.invalid/historical';
  await registerPublicAliases(sql, {
    podcastId: id,
    expectedFeedUrl: feed,
    aliases: [alias],
    evidence: { type: 'reviewed', reference: 'route-fixture' },
  });
  actor = null;
  const aliasFeed = await feedRoute.GET(
    request(`/api/feed?url=${encodeURIComponent(alias)}`),
  );
  assert.equal(aliasFeed.status, 200);
  const canonicalResult = await aliasFeed.json();
  assert.equal(canonicalResult.id, id);
  assert.equal(canonicalResult.feed, feed);
  assert(
    canonicalResult.episodes.every(
      (value: { feed: string }) => value.feed === feed,
    ),
  );
  actor = 'other';
  assert.equal(
    (
      await (await search.POST(request('/api/search', { term: alias }))).json()
    )[0].id,
    id,
  );
  assert.deepEqual(
    await (
      await resolution.POST(
        request('/api/subscriptions/resolve', {
          ...scope(),
          feedUrls: [alias],
        }),
      )
    ).json(),
    {
      ...scope(),
      items: [
        {
          index: 0,
          podcastId: id,
          status: 'resolved',
          retryAfterSeconds: null,
        },
      ],
    },
  );
  actor = null;
  shortLink = { feed: alias, guid: episode.guid };
  await assert.rejects(
    shortPage({ params: Promise.resolve({ slug: 'synthetic' }) }),
    (error: unknown) =>
      (error as { digest?: string }).digest ===
      `NEXT_REDIRECT;replace;/episodes/${id}/${episodeId};307;`,
  );
  console.log('Private route authorization, cache and reference checks passed');
} finally {
  await sql.end();
}
