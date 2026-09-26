import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { refreshFeed } from './feed-refresh';
import { getDuePodcasts } from './feed-schedule';

const databaseUrl = process.env.TEST_DATABASE_URL;
const schema = `feed_refresh_test_${randomUUID().replaceAll('-', '')}`;
const xml = readFileSync(
  new URL('./__fixtures__/refresh.xml', import.meta.url),
  'utf8',
);

describe.skipIf(!databaseUrl)('feed refresh with PostgreSQL', () => {
  let sql: postgres.Sql;
  let admin: postgres.Sql;
  let server: ReturnType<typeof Bun.serve>;
  let respond: (request: Request) => Promise<Response>;
  let requests: number;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('TEST_DATABASE_URL required');
    admin = postgres(databaseUrl, { onnotice: () => {} });
    await admin`CREATE SCHEMA ${admin(schema)}`;
    sql = postgres(databaseUrl, {
      connection: { search_path: schema },
      onnotice: () => {},
    });
    await sql.unsafe(readFileSync('schema.sql', 'utf8'));
    await sql.unsafe(
      readFileSync('migrations/0008-tiered-episodes.sql', 'utf8'),
    );
    await sql`
      ALTER TABLE episodes
        DROP COLUMN title, DROP COLUMN summary, DROP COLUMN duration,
        DROP COLUMN episode_art, DROP COLUMN file_url,
        DROP COLUMN file_length, DROP COLUMN file_type
    `;
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (request) => {
        requests++;
        return respond(request);
      },
    });
  });

  afterAll(async () => {
    server?.stop(true);
    await sql?.end();
    if (admin) {
      await admin`DROP SCHEMA ${admin(schema)} CASCADE`;
      await admin.end();
    }
  });

  beforeEach(async () => {
    requests = 0;
    respond = async (request) =>
      request.headers.get('if-none-match') === '"v1"'
        ? new Response(null, { status: 304 })
        : new Response(xml, { headers: { etag: '"v1"' } });
    await sql`TRUNCATE podcasts, authors, users RESTART IDENTITY CASCADE`;
    await sql`INSERT INTO authors (id, name) VALUES (1, 'Test author')`;
    await sql`INSERT INTO users (id, email) VALUES ('test-user', 'test@example.com')`;
    await sql`
      INSERT INTO podcasts (id, feed_url, title, author_id, cover, is_essential, last_published)
      VALUES (139, ${server.url.href}, 'Cached podcast', 1, 'cover', true, now())
    `;
    await sql`
      INSERT INTO subscriptions (user_id, podcast_id) VALUES ('test-user', 139)
    `;
    await sql`
      INSERT INTO feed_poll_state (podcast_id, last_polled_at, next_poll_at)
      VALUES (139, now() - interval '2 hours', now() + interval '22 hours')
    `;
    await sql`
      INSERT INTO episodes (podcast_id, guid, published)
      VALUES (139, 'episode-five', now() - interval '7 days')
    `;
    await sql`
      INSERT INTO episode_content (episode_id, title, file_url)
      SELECT id, 'NoSleep Podcast - S25E05', 'https://example.com/five.mp3'
      FROM episodes
    `;
  });

  test('subscribed feeds are due hourly without waiting for the old daily schedule', async () => {
    expect(await getDuePodcasts(sql, 500)).toEqual([{ id: 139 }]);
    expect(await refreshFeed(sql, 139, 'scheduled')).toBe('updated');
    const [state] = await sql`
      SELECT failures, extract(epoch FROM next_poll_at - last_polled_at)::int AS seconds
      FROM feed_poll_state WHERE podcast_id = 139
    `;
    expect(state).toEqual({ failures: 0, seconds: 3600 });
    const titles = await sql`
      SELECT c.title FROM episodes e JOIN episode_content c ON c.episode_id = e.id
      WHERE e.podcast_id = 139 ORDER BY c.title
    `;
    expect(titles.map((row) => row.title)).toEqual([
      'NoSleep Podcast - S25E05',
      'NoSleep Podcast - S25E06',
    ]);
    expect(await getDuePodcasts(sql, 500)).toEqual([]);
  });

  test('recent playback follows feeds even before tier recomputation or after a hiatus', async () => {
    await sql`DELETE FROM subscriptions`;
    await sql`
      UPDATE podcasts SET is_essential = false, last_published = now() - interval '365 days'
    `;
    await sql`
      INSERT INTO playback_progress (user_id, episode_id, position)
      SELECT 'test-user', id, 10 FROM episodes
    `;
    expect(await getDuePodcasts(sql, 500)).toEqual([{ id: 139 }]);
    expect(await refreshFeed(sql, 139, 'scheduled')).toBe('updated');
    const [state] = await sql`
      SELECT extract(epoch FROM next_poll_at - last_polled_at)::int AS seconds
      FROM feed_poll_state
    `;
    expect(state.seconds).toBe(3600);
    await sql`UPDATE playback_progress SET updated_at = now() - interval '91 days'`;
    await sql`UPDATE feed_poll_state SET next_poll_at = now() - interval '1 day'`;
    expect(await getDuePodcasts(sql, 500)).toEqual([]);
  });

  test('chart-only feeds retain their configured seconds interval', async () => {
    await sql`DELETE FROM subscriptions`;
    expect(await getDuePodcasts(sql, 500)).toEqual([]);
    await sql`UPDATE podcasts SET update_frequency = 7200`;
    await sql`UPDATE feed_poll_state SET next_poll_at = now() - interval '1 second'`;
    expect(await refreshFeed(sql, 139, 'scheduled')).toBe('updated');
    const [state] = await sql`
      SELECT extract(epoch FROM next_poll_at - last_polled_at)::int AS seconds
      FROM feed_poll_state
    `;
    expect(state.seconds).toBe(7200);
  });

  test('missing poll-state rows do not prevent polling', async () => {
    await sql`DELETE FROM feed_poll_state`;
    expect(await getDuePodcasts(sql, 500)).toEqual([{ id: 139 }]);
    expect(await refreshFeed(sql, 139, 'scheduled')).toBe('updated');
    const [state] = await sql`SELECT failures FROM feed_poll_state`;
    expect(state.failures).toBe(0);
  });

  test('fresh feeds skip downloads and stale page opens update them early', async () => {
    await sql`UPDATE feed_poll_state SET last_polled_at = now() - interval '14 minutes'`;
    expect(await refreshFeed(sql, 139)).toBe('skipped');
    expect(requests).toBe(0);
    await sql`UPDATE feed_poll_state SET last_polled_at = now() - interval '16 minutes'`;
    expect(await refreshFeed(sql, 139)).toBe('updated');
    expect(requests).toBe(1);
  });

  test('concurrent workers download a feed only once', async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    respond = async () => {
      started.resolve();
      await release.promise;
      return new Response(xml);
    };
    const first = refreshFeed(sql, 139, 'scheduled');
    await started.promise;
    const other = postgres(databaseUrl ?? '', {
      connection: { search_path: schema },
    });
    try {
      expect(await refreshFeed(other, 139)).toBe('busy');
      expect(requests).toBe(1);
    } finally {
      release.resolve();
      await other.end();
    }
    expect(await first).toBe('updated');
    expect(await refreshFeed(sql, 139)).toBe('skipped');
    expect(requests).toBe(1);
  });

  test('304 responses advance the schedule without rewriting podcast data', async () => {
    await refreshFeed(sql, 139);
    const [before] = await sql`SELECT updated_at FROM podcasts WHERE id = 139`;
    await sql`UPDATE feed_poll_state SET last_polled_at = now() - interval '16 minutes'`;
    expect(await refreshFeed(sql, 139)).toBe('not_modified');
    const [after] = await sql`SELECT updated_at FROM podcasts WHERE id = 139`;
    expect(after.updated_at).toEqual(before.updated_at);
    expect(requests).toBe(2);
    expect(await getDuePodcasts(sql, 500)).toEqual([]);
  });

  test('evicted content is rebuilt even when the feed is fresh and unchanged', async () => {
    await refreshFeed(sql, 139);
    await sql`DELETE FROM episode_content`;
    expect(await refreshFeed(sql, 139, 'rebuild')).toBe('updated');
    const [content] = await sql`SELECT title FROM episode_content`;
    expect(content.title).toBe('NoSleep Podcast - S25E06');
    expect(requests).toBe(2);
  });

  test('failed requests back off across page opens, rebuilds, and scheduled polls', async () => {
    respond = async () => new Response(null, { status: 503 });
    expect(await refreshFeed(sql, 139)).toBe('error');
    const [state] = await sql`
      SELECT failures, extract(epoch FROM next_poll_at - last_polled_at)::int AS seconds
      FROM feed_poll_state
    `;
    expect(state).toEqual({ failures: 1, seconds: 7200 });
    expect(await getDuePodcasts(sql, 500)).toEqual([]);
    for (const mode of ['stale', 'scheduled', 'rebuild'] as const) {
      expect(await refreshFeed(sql, 139, mode)).toBe('skipped');
    }
    expect(requests).toBe(1);
  });

  test('repeated failures deactivate a feed and successful retries reactivate it', async () => {
    await sql`UPDATE feed_poll_state SET failures = 4, next_poll_at = now() - interval '1 second'`;
    respond = async () => new Response(null, { status: 503 });
    expect(await refreshFeed(sql, 139)).toBe('error');
    const [inactive] = await sql`SELECT is_active FROM podcasts WHERE id = 139`;
    expect(inactive.is_active).toBe(false);
    expect(await getDuePodcasts(sql, 500)).toEqual([]);
    await sql`UPDATE feed_poll_state SET next_poll_at = now() - interval '1 second', last_polled_at = now() - interval '2 days'`;
    respond = async () => new Response(xml);
    expect(await refreshFeed(sql, 139)).toBe('updated');
    const [active] = await sql`SELECT is_active FROM podcasts WHERE id = 139`;
    expect(active.is_active).toBe(true);
  });

  test('episode write failures roll back metadata and still persist backoff', async () => {
    await sql`
      ALTER TABLE episode_content ADD CONSTRAINT reject_six
      CHECK (title <> 'NoSleep Podcast - S25E06')
    `;
    try {
      expect(await refreshFeed(sql, 139)).toBe('error');
      const [podcast] = await sql`SELECT title FROM podcasts WHERE id = 139`;
      expect(podcast.title).toBe('Cached podcast');
      const episodes =
        await sql`SELECT guid FROM episodes WHERE podcast_id = 139`;
      expect(episodes.map((row) => row.guid)).toEqual(['episode-five']);
      const [state] = await sql`SELECT failures, hash FROM feed_poll_state`;
      expect(state).toEqual({ failures: 1, hash: null });
    } finally {
      await sql`ALTER TABLE episode_content DROP CONSTRAINT reject_six`;
    }
  });

  test('missing podcasts do not cause network requests', async () => {
    expect(await refreshFeed(sql, 999)).toBe('not_found');
    expect(requests).toBe(0);
  });
});
