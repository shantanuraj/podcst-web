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
import { createSchemaFixture } from '../../../scripts/lib/schema-fixture';
import {
  prepareEpisodeRead,
  readEpisodePage,
  type SortDirection,
  type SortField,
} from './episode-read';

const databaseUrl = process.env.TEST_DATABASE_URL;
const schema = `episode_read_test_${randomUUID().replaceAll('-', '')}`;
const xml = readFileSync(
  new URL('./__fixtures__/refresh.xml', import.meta.url),
  'utf8',
);

describe.skipIf(!databaseUrl)('episode reads with PostgreSQL', () => {
  let sql: postgres.Sql;
  let admin: postgres.Sql;
  let server: ReturnType<typeof Bun.serve>;
  let respond: () => Response;
  let requests: number;
  let statements: string[];

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('TEST_DATABASE_URL required');
    admin = postgres(databaseUrl, { onnotice: () => {} });
    await admin`CREATE SCHEMA ${admin(schema)}`;
    sql = postgres(databaseUrl, {
      connection: { search_path: schema },
      onnotice: () => {},
      debug: (_connection, query) => statements?.push(query),
      types: {
        bigint: {
          to: 20,
          from: [20],
          serialize: (value: number) => String(value),
          parse: Number,
        },
      },
    });
    await createSchemaFixture(sql);
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => {
        requests++;
        return respond();
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
    respond = () => new Response(xml);
    await sql`TRUNCATE podcasts, authors RESTART IDENTITY CASCADE`;
    await sql`INSERT INTO authors (id, name) VALUES (1, 'Author')`;
    await sql`
      INSERT INTO podcasts (id, feed_url, title, author_id, cover)
      VALUES (1, ${server.url.href}, 'Podcast', 1, 'cover'),
             (2, 'https://example.com/empty', 'Empty', 1, 'cover')
    `;
    await sql`
      INSERT INTO episodes (id, podcast_id, guid, published)
      VALUES (101, 1, 'alpha', '2026-01-01'),
             (102, 1, 'beta', '2026-01-02'),
             (103, 1, 'delta', '2026-01-03'),
             (104, 1, 'charlie', '2026-01-02')
    `;
    await sql`
      INSERT INTO episode_content (episode_id, title, summary, duration, file_url)
      VALUES (101, 'Alpha', 'Shared needle', 300, 'https://example.com/alpha.mp3'),
             (102, 'Beta', 'Other', NULL, 'https://example.com/beta.mp3'),
             (103, 'Delta', 'Another needle', 60, 'https://example.com/delta.mp3'),
             (104, 'Charlie', NULL, 300, 'https://example.com/charlie.mp3')
    `;
    statements = [];
  });

  test('records access in the content check without downloading a warm feed', async () => {
    await prepareEpisodeRead(sql, 1);
    expect(statements).toHaveLength(1);
    expect(requests).toBe(0);
    const [first] =
      await sql`SELECT last_accessed_at FROM podcasts WHERE id = 1`;
    expect(first.last_accessed_at).toBeInstanceOf(Date);
    await prepareEpisodeRead(sql, 1);
    const [second] =
      await sql`SELECT last_accessed_at FROM podcasts WHERE id = 1`;
    expect(second.last_accessed_at).toEqual(first.last_accessed_at);
    await sql`UPDATE podcasts SET last_accessed_at = now() - interval '2 hours' WHERE id = 1`;
    await prepareEpisodeRead(sql, 1);
    const [refreshed] =
      await sql`SELECT last_accessed_at FROM podcasts WHERE id = 1`;
    expect(refreshed.last_accessed_at.getTime()).toBeGreaterThanOrEqual(
      first.last_accessed_at.getTime(),
    );
  });

  test('does not rebuild empty or missing podcasts', async () => {
    await prepareEpisodeRead(sql, 2);
    await prepareEpisodeRead(sql, 999);
    expect(requests).toBe(0);
    expect(
      (await readEpisodePage(sql, { podcastId: 2 })).episodes,
    ).toHaveLength(0);
    expect((await readEpisodePage(sql, { podcastId: 999 })).total).toBe(0);
  });

  test('preserves partially retained content without a rebuild', async () => {
    await sql`DELETE FROM episode_content WHERE episode_id <> 101`;
    await prepareEpisodeRead(sql, 1);
    expect(requests).toBe(0);
    const page = await readEpisodePage(sql, { podcastId: 1 });
    expect(page.total).toBe(4);
    expect(page.episodes).toHaveLength(4);
  });

  test('waits for evicted content to rebuild before the page is read', async () => {
    await sql`DELETE FROM episodes`;
    await sql`
      INSERT INTO episodes (id, podcast_id, guid, published)
      VALUES (101, 1, 'episode-six', '2026-09-26')
    `;
    await sql`
      INSERT INTO feed_poll_state (podcast_id, last_polled_at, next_poll_at, hash)
      VALUES (1, now(), now() + interval '1 day', 'unchanged')
    `;
    await prepareEpisodeRead(sql, 1);
    const page = await readEpisodePage(sql, { podcastId: 1 });
    expect(requests).toBe(1);
    expect(page.total).toBe(1);
    expect(page.episodes[0]).toMatchObject({
      id: 101,
      title: 'NoSleep Podcast - S25E06',
      file_url: 'https://example.com/episode-six.mp3',
    });
  });

  test('honors rebuild failure backoff across repeated reads', async () => {
    await sql`DELETE FROM episode_content`;
    respond = () => new Response(null, { status: 503 });
    await prepareEpisodeRead(sql, 1);
    await prepareEpisodeRead(sql, 1);
    expect(requests).toBe(1);
    const [state] =
      await sql`SELECT failures FROM feed_poll_state WHERE podcast_id = 1`;
    expect(state.failures).toBe(1);
  });

  const orders: [SortField, SortDirection, number[]][] = [
    ['published', 'desc', [103, 104, 102, 101]],
    ['published', 'asc', [101, 102, 104, 103]],
    ['title', 'asc', [101, 102, 104, 103]],
    ['title', 'desc', [103, 104, 102, 101]],
    ['duration', 'asc', [103, 101, 104, 102]],
    ['duration', 'desc', [104, 101, 103, 102]],
  ];

  for (const [sortBy, sortDir, expected] of orders) {
    test(`paginates ${sortBy} ${sortDir} with stable ties and null durations last`, async () => {
      const first = await readEpisodePage(sql, {
        podcastId: 1,
        sortBy,
        sortDir,
        limit: 2,
      });
      expect(first.episodes.map((episode) => episode.id)).toEqual(
        expected.slice(0, 2),
      );
      expect(first.total).toBe(4);
      expect(first.hasMore).toBe(true);
      expect(first.nextCursor).toBe(2);
      const second = await readEpisodePage(sql, {
        podcastId: 1,
        sortBy,
        sortDir,
        limit: 2,
        cursor: first.nextCursor,
      });
      expect(second.episodes.map((episode) => episode.id)).toEqual(
        expected.slice(2),
      );
      expect(second.total).toBe(4);
      expect(second.hasMore).toBe(false);
      expect(second.nextCursor).toBeUndefined();
    });
  }

  test('searches titles and summaries case insensitively and counts matching rows', async () => {
    const first = await readEpisodePage(sql, {
      podcastId: 1,
      search: 'NEEDLE',
      limit: 1,
    });
    expect(first.total).toBe(2);
    expect(first.episodes.map((episode) => episode.id)).toEqual([103]);
    const second = await readEpisodePage(sql, {
      podcastId: 1,
      search: 'NEEDLE',
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second.episodes.map((episode) => episode.id)).toEqual([101]);
    expect(second.hasMore).toBe(false);
    const title = await readEpisodePage(sql, { podcastId: 1, search: 'beTA' });
    expect(title.episodes.map((episode) => episode.id)).toEqual([102]);
    expect(title.total).toBe(1);
  });

  test('keeps totals when an offset is beyond the final page', async () => {
    expect(
      await readEpisodePage(sql, { podcastId: 1, cursor: 10 }),
    ).toMatchObject({
      episodes: [],
      total: 4,
      hasMore: false,
    });
    expect(
      await readEpisodePage(sql, {
        podcastId: 1,
        search: 'needle',
        cursor: 10,
      }),
    ).toMatchObject({
      episodes: [],
      total: 2,
      hasMore: false,
    });
  });

  test('treats search input as a value rather than SQL', async () => {
    expect(
      await readEpisodePage(sql, { podcastId: 1, search: "' OR 1=1 --" }),
    ).toMatchObject({
      episodes: [],
      total: 0,
      hasMore: false,
    });
  });
});
