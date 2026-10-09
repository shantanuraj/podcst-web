import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { FEED_LIMITS, feedValidator } from '@/shared/feed-contract';
import { installFeedTransportFixture } from '../../../scripts/fixtures/feed-transport';
import { startPostgres } from '../../../scripts/lib/postgres-sandbox';
import { createSchemaFixture } from '../../../scripts/lib/schema-fixture';
import { loadMigrations } from '../../../scripts/migrations';
import {
  feedFreshness,
  readFeedState,
  requestFeedRefresh,
} from './feed-demand';
import { refreshFeed } from './feed-refresh';
import { getDuePodcasts } from './feed-schedule';

installFeedTransportFixture();
const id = '9007199254740993';
const xml =
  '<rss><channel><title>Updated</title><description>Fixture</description><item><guid>one</guid><title>One</title><enclosure url="https://example.invalid/audio.mp3" type="audio/mpeg"/></item></channel></rss>';

describe.skipIf(!process.env.PG_BIN)('durable feed demand', () => {
  let cluster: ReturnType<typeof startPostgres>;
  let sql: postgres.Sql;
  let parallel: postgres.Sql;
  let server: ReturnType<typeof Bun.serve>;
  let respond: (request: Request) => Promise<Response>;
  let requests = 0;
  let admissions = 0;
  const admit = async () => {
    admissions++;
  };
  const state = async (episodeId?: string) => {
    const row = await readFeedState(sql, id, 'owner', episodeId);
    if (!row) throw new Error('Fixture source missing');
    const value = feedFreshness(row);
    expect(feedValidator('freshness')(value)).toBe(true);
    return value;
  };
  const demand = () => requestFeedRefresh(sql, id, 'owner', admit);

  beforeAll(async () => {
    cluster = startPostgres();
    sql = cluster.sql;
    parallel = postgres({ ...cluster.options, max: 16 });
    await createSchemaFixture(sql);
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        requests++;
        return respond(request);
      },
    });
  }, 30_000);
  afterAll(async () => {
    server?.stop(true);
    await parallel?.end();
    await cluster?.stop();
  });
  beforeEach(async () => {
    requests = 0;
    admissions = 0;
    respond = async () => new Response(xml, { headers: { etag: '"v1"' } });
    await sql`TRUNCATE authors, users RESTART IDENTITY CASCADE`;
    await sql`INSERT INTO users (id, email) VALUES ('owner', 'owner@example.invalid'), ('other', 'other@example.invalid')`;
    await sql`INSERT INTO authors (id, name) VALUES (1, 'Fixture')`;
    await sql`INSERT INTO podcasts (id, author_id, feed_url, title, cover, owner_user_id, is_active, is_essential)
      VALUES (${id}, 1, ${server.url.href}, 'Cached', '', 'owner', false, false)`;
  });

  test('cold reads and demand admission do not fetch; the normal worker repairs inactive nonessential sources', async () => {
    expect(await state()).toMatchObject({
      content: 'missing',
      state: 'stale',
      checkedAtMs: null,
    });
    expect(await getDuePodcasts(sql, 10)).toEqual([]);
    expect(await demand()).toMatchObject({
      content: 'missing',
      state: 'pending',
    });
    expect(requests).toBe(0);
    expect(await getDuePodcasts(sql, 10, 'demand')).toEqual([{ id }]);
    expect(await getDuePodcasts(sql, 10, 'scheduled')).toEqual([]);
    expect(await refreshFeed(sql, id, 'scheduled')).toBe('updated');
    expect(requests).toBe(1);
    expect(await state()).toMatchObject({ content: 'cached', state: 'fresh' });
    expect(
      (await sql`SELECT demand_token FROM feed_poll_state`)[0].demand_token,
    ).toBeNull();
    expect(await getDuePodcasts(sql, 10)).toEqual([]);
  });

  test('duplicate demands coalesce without consuming admission or extending the request lifetime', async () => {
    await demand();
    const [before] =
      await sql`SELECT demand_token, demand_expires_at FROM feed_poll_state`;
    await Promise.all(
      Array.from({ length: 12 }, () =>
        requestFeedRefresh(parallel, id, 'owner', admit),
      ),
    );
    expect(admissions).toBe(1);
    expect(
      (
        await sql`SELECT demand_token, demand_expires_at FROM feed_poll_state`
      )[0],
    ).toEqual(before);
  });

  test('private visibility is checked before admission and again after its asynchronous boundary', async () => {
    expect(await requestFeedRefresh(sql, id, 'other', admit)).toBeNull();
    expect(admissions).toBe(0);
    const response = await requestFeedRefresh(sql, id, 'owner', async () => {
      await parallel`UPDATE podcasts SET owner_user_id = 'other' WHERE id = ${id}`;
    });
    expect(response).toBeNull();
    expect(await sql`SELECT * FROM feed_poll_state`).toHaveLength(0);
    expect(requests).toBe(0);
  });

  test('expired demands stop reporting pending and can be re-admitted', async () => {
    await demand();
    await sql`UPDATE feed_poll_state SET demand_requested_at = now() - interval '1 hour', demand_expires_at = now() - interval '1 second'`;
    expect((await state()).state).toBe('stale');
    expect(await getDuePodcasts(sql, 10)).toEqual([]);
    expect((await demand())?.state).toBe('pending');
    expect(admissions).toBe(2);
  });

  test('failures preserve successful validation time and backoff cannot be bypassed', async () => {
    await demand();
    await refreshFeed(sql, id, 'scheduled');
    await sql`UPDATE feed_poll_state SET last_success_at = now() - interval '2 hours', last_polled_at = now() - interval '2 hours'`;
    const before = await state();
    respond = async () => new Response(null, { status: 503 });
    await demand();
    expect(await refreshFeed(sql, id, 'scheduled')).toBe('error');
    const failure = await state();
    expect(failure.state).toBe('backoff');
    expect(failure.content).toBe('cached');
    expect(failure.checkedAtMs).toBe(before.checkedAtMs);
    const count = admissions;
    expect((await demand())?.state).toBe('backoff');
    expect(admissions).toBe(count);
    expect(await getDuePodcasts(sql, 10)).toEqual([]);
  });

  test('a successful empty feed is cached, while a missing retained episode is unavailable without a repair loop', async () => {
    respond = async () =>
      new Response(
        '<rss><channel><title>Empty</title><description>Fixture</description></channel></rss>',
      );
    await demand();
    await refreshFeed(sql, id, 'scheduled');
    expect(await state()).toMatchObject({ content: 'cached', state: 'fresh' });
    await sql`INSERT INTO episodes (id, podcast_id, guid, published) VALUES (44, ${id}, 'removed', now())`;
    expect(await state()).toMatchObject({ content: 'cached', state: 'fresh' });
    expect(await state('44')).toMatchObject({
      content: 'missing',
      state: 'unavailable',
    });
    const before = admissions;
    expect(
      (await requestFeedRefresh(sql, id, 'owner', admit, '44'))?.state,
    ).toBe('unavailable');
    expect(admissions).toBe(before);
    expect(requests).toBe(1);
  });

  test('a rebuild admitted during a conditional fetch survives its 304 and bypasses validators next time', async () => {
    await demand();
    await refreshFeed(sql, id, 'scheduled');
    await sql`UPDATE feed_poll_state SET last_polled_at = now() - interval '1 day', last_success_at = now() - interval '1 day', last_rebuilt_at = now() - interval '1 day'`;
    await demand();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    respond = async (request) => {
      expect(request.headers.get('if-none-match')).toBe('"v1"');
      started.resolve();
      await release.promise;
      return new Response(null, { status: 304 });
    };
    const refreshing = refreshFeed(parallel, id, 'scheduled');
    await started.promise;
    let newer: string | null = null;
    try {
      await sql`DELETE FROM episode_content`;
      expect((await demand())?.state).toBe('pending');
      const [row] =
        await sql`SELECT demand_token, demand_rebuild FROM feed_poll_state`;
      expect(row.demand_rebuild).toBe(true);
      newer = row.demand_token;
    } finally {
      release.resolve();
    }
    expect(await refreshing).toBe('not_modified');
    expect(
      (await sql`SELECT demand_token FROM feed_poll_state`)[0].demand_token,
    ).toBe(newer);
    respond = async (request) => {
      expect(request.headers.has('if-none-match')).toBe(false);
      return new Response(xml);
    };
    expect(await refreshFeed(sql, id, 'scheduled')).toBe('updated');
    expect((await state()).state).toBe('fresh');
    expect(requests).toBe(3);
  });

  test('source changes invalidate demand and validation timestamps even on URL round trips', async () => {
    await demand();
    await refreshFeed(sql, id, 'scheduled');
    await sql`UPDATE feed_poll_state SET last_success_at = now() - interval '1 day'`;
    await demand();
    await sql`UPDATE podcasts SET feed_url = 'https://example.invalid/new' WHERE id = ${id}`;
    await sql`UPDATE podcasts SET feed_url = ${server.url.href} WHERE id = ${id}`;
    expect(
      (
        await sql`SELECT demand_token, last_success_at, last_rebuilt_at FROM feed_poll_state`
      )[0],
    ).toEqual({
      demand_token: null,
      last_success_at: null,
      last_rebuilt_at: null,
    });
  });

  test('queue capacity is global and enforced under concurrent admission', async () => {
    const capacity = FEED_LIMITS.refresh.queueCapacity;
    await sql`INSERT INTO podcasts (id, author_id, feed_url, title, cover)
      SELECT n, 1, 'https://example.invalid/' || n, 'Fixture', '' FROM generate_series(1, ${capacity + 1}) n`;
    await sql`INSERT INTO feed_poll_state (podcast_id, demand_token, demand_requested_at, demand_expires_at)
      SELECT id, ${randomUUID()}::uuid, now(), now() + interval '10 minutes' FROM podcasts WHERE id < ${capacity}`;
    const results = await Promise.allSettled(
      [capacity, capacity + 1].map((id) =>
        requestFeedRefresh(parallel, String(id), null, admit),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(
      (
        await sql`SELECT count(*)::int AS count FROM feed_poll_state WHERE demand_expires_at > now()`
      )[0].count,
    ).toBe(capacity);
  });

  test('all refresh entry points share ten execution leases and expired capacity is reclaimable', async () => {
    const capacity = FEED_LIMITS.refresh.concurrencyGlobal;
    await sql`INSERT INTO podcasts (id, author_id, feed_url, title, cover)
      SELECT n, 1, ${server.url.href} || n, 'Fixture', '' FROM generate_series(1, ${capacity}) n`;
    await sql`INSERT INTO feed_poll_state (podcast_id, refresh_token, refresh_expires_at)
      SELECT id, ${randomUUID()}::uuid, now() + interval '1 minute' FROM podcasts WHERE id <= ${capacity}`;
    await demand();
    expect(await refreshFeed(sql, id, 'scheduled')).toBe('busy');
    expect(requests).toBe(0);
    await sql`UPDATE feed_poll_state SET refresh_expires_at = now() - interval '1 second' WHERE podcast_id = 1`;
    expect(await refreshFeed(sql, id, 'scheduled')).toBe('updated');
    expect(requests).toBe(1);
  });

  test('expiry during content writes rolls back publication without consuming demand', async () => {
    await demand();
    await sql`CREATE FUNCTION expire_during_content() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN UPDATE feed_poll_state SET refresh_expires_at = clock_timestamp() - interval '1 second'; RETURN NEW; END $$`;
    await sql`CREATE TRIGGER expire_content BEFORE INSERT ON episode_content FOR EACH ROW EXECUTE FUNCTION expire_during_content()`;
    try {
      expect(await refreshFeed(sql, id, 'scheduled')).toBe('skipped');
      expect(await sql`SELECT * FROM episode_content`).toHaveLength(0);
      expect(
        (await sql`SELECT title FROM podcasts WHERE id = ${id}`)[0].title,
      ).toBe('Cached');
      const [row] =
        await sql`SELECT demand_token, last_success_at, failures FROM feed_poll_state WHERE podcast_id = ${id}`;
      expect(row.demand_token).toBeString();
      expect(row.last_success_at).toBeNull();
      expect(row.failures).toBe(0);
    } finally {
      await sql`DROP TRIGGER expire_content ON episode_content`;
      await sql`DROP FUNCTION expire_during_content()`;
    }
  });

  test('failed admission does not claim pending or discard cached content', async () => {
    await demand();
    await refreshFeed(sql, id, 'scheduled');
    await sql`UPDATE feed_poll_state SET last_success_at = now() - interval '1 day'`;
    await expect(
      requestFeedRefresh(sql, id, 'owner', async () => {
        throw new Error('Limiter unavailable');
      }),
    ).rejects.toThrow('Limiter unavailable');
    expect(await state()).toMatchObject({ content: 'cached', state: 'stale' });
  });
});

describe.skipIf(!process.env.PG_BIN)('feed demand migration', () => {
  test('preserves schedules, refuses partial demand, rolls back and pins trigger resolution', async () => {
    const cluster = startPostgres();
    const sql = cluster.sql;
    try {
      await createSchemaFixture(sql, '0011-feed-refresh-leases.sql');
      await sql`INSERT INTO authors (id, name) VALUES (1, 'Fixture')`;
      await sql`INSERT INTO podcasts (id, author_id, feed_url, title, cover) VALUES (1, 1, 'https://example.invalid/old', 'Fixture', '')`;
      await sql`INSERT INTO feed_poll_state (podcast_id, hash, failures, last_polled_at) VALUES (1, 'cached', 0, now())`;
      const [before] = await sql`SELECT * FROM feed_poll_state`;
      const migration = loadMigrations().find(
        (item) => item.name === '0012-feed-refresh-demand.sql',
      );
      if (!migration) throw new Error('Migration missing');
      await expect(
        sql.begin(async (tx) => {
          await tx.unsafe(migration.source);
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect((await sql`SELECT * FROM feed_poll_state`)[0]).toEqual(before);
      await sql.begin((tx) => tx.unsafe(migration.source));
      expect(
        (
          await sql`SELECT last_success_at, last_rebuilt_at FROM feed_poll_state`
        )[0],
      ).toEqual({ last_success_at: null, last_rebuilt_at: null });
      await expect(
        sql`UPDATE feed_poll_state SET demand_token = ${randomUUID()}`.execute(),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        sql`UPDATE feed_poll_state SET demand_token = ${randomUUID()}, demand_requested_at = now()`.execute(),
      ).rejects.toMatchObject({ code: '23514' });
      await sql`CREATE TEMP TABLE feed_poll_state (podcast_id bigint)`;
      await sql`UPDATE podcasts SET feed_url = 'https://example.invalid/new' WHERE id = 1`;
      expect(
        (await sql`SELECT hash FROM public.feed_poll_state`)[0].hash,
      ).toBeNull();
    } finally {
      await cluster.stop();
    }
  }, 30_000);
});
