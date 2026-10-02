import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { lstatSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { NextRequest } from 'next/server';

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
  getSession: async () => (actor ? { userId: actor } : null),
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
const search = await import('../../src/app/api/search/route');
const feedRoute = await import('../../src/app/api/feed/route');
const info = await import('../../src/app/api/feed/info/route');
const episodes = await import('../../src/app/api/feed/episodes/route');
const refresh = await import('../../src/app/api/feed/refresh/route');
const subscriptions = await import('../../src/app/api/subscriptions/route');
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
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
  const episodeId = Number(episode.id);
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
    (await subscriptions.POST(request('/api/subscriptions', { podcastId: id })))
      .status,
    200,
  );
  assert.equal(
    (
      await progress.PUT(
        request('/api/progress', { episodeId, position: 37, completed: false }),
      )
    ).status,
    200,
  );
  assert.equal((await progress.GET()).status, 200);
  assert.equal((await (await progress.GET()).json()).episode.isPrivate, true);
  assert.equal((await (await subscriptions.GET()).json())[0].isPrivate, true);
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
  assert.equal(
    (await subscriptions.POST(request('/api/subscriptions', { podcastId: id })))
      .status,
    404,
  );
  assert.equal(
    (await progress.PUT(request('/api/progress', { episodeId, position: 99 })))
      .status,
    404,
  );
  assert.equal(await (await progress.GET()).json(), null);
  assert.deepEqual(
    await (
      await subscriptions.POST(
        request('/api/subscriptions', { feedUrls: [feed] }),
      )
    ).json(),
    { succeeded: 0, failed: 1 },
  );
  await sql`INSERT INTO subscriptions (user_id, podcast_id) VALUES ('other', ${id})`;
  await sql`INSERT INTO playback_progress (user_id, episode_id, position) VALUES ('other', ${episodeId}, 88)`;
  assert.deepEqual(await (await subscriptions.GET()).json(), []);
  assert.equal(await (await progress.GET()).json(), null);
  assert.equal(
    await progressStore.getEpisodeProgress('other', episodeId),
    null,
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
  await indexPodcast(sql, feed, 999);
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
      await subscriptions.POST(
        request('/api/subscriptions', { feedUrls: [alias] }),
      )
    ).json(),
    { succeeded: 1, failed: 0 },
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
